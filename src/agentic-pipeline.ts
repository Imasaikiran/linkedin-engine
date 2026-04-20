import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
dayjs.extend(isoWeek);
import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

import { loadBrand, type Brand } from './lib/brand.js';
import { makeClient } from './lib/llm.js';
import { makeLogger } from './lib/log.js';
import { runVoiceGate } from './lib/gate.js';
import {
  runOrchestrator,
  type DayRunResult,
  type OrchestratorResult,
} from './agents/orchestrator.js';

// ────────────────────────────────────────────────────────────────────────────
// Note on the hallucination gate
// ────────────────────────────────────────────────────────────────────────────
// TODO(task-9+): wire the hallucination gate. The agentic drafter (see
// `src/agents/drafter.ts`) does not currently expose `claims[]` on its public
// `Draft` shape, so `runHallucinationGate({ claims, sources, voiceCorpusUrls })`
// has nothing to operate on. Per the multi-agent spec, the hallucination gate
// is a "downstream safety net" — it is intentionally NOT applied here. When the
// drafter is updated to surface claims (or the orchestrator does), the call
// belongs in the per-day final-pass loop below, alongside `runVoiceGate`.

const REPO_ROOT = process.cwd();

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function computeIsoWeek(d: Date): string {
  const w = dayjs(d).isoWeek();
  return `${dayjs(d).isoWeekYear()}-W${String(w).padStart(2, '0')}`;
}

export const AgenticDaySummarySchema = z.object({
  day: z.enum(['mon', 'wed', 'fri']),
  status: z.enum(['published', 'skipped']),
  reason: z.string().optional(),
  reason_class: z.string().optional(),
  retries: z.number().int().nonnegative(),
  pillar: z.string().optional(),
  word_count: z.number().int().nonnegative().optional(),
  char_count: z.number().int().nonnegative().optional(),
});
export type AgenticDaySummary = z.infer<typeof AgenticDaySummarySchema>;

export const AgenticRunSummarySchema = z.object({
  week: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  scout_source: z.enum(['web_search', 'rss_fallback']),
  orchestrator_cost_usd: z.number().nonnegative(),
  wall_ms: z.number().int().nonnegative(),
  aborted: z.boolean(),
  abort_reason: z.string().optional(),
  drafts_produced: z.number().int().nonnegative(),
  drafts_skipped: z.number().int().nonnegative(),
  days: z.array(AgenticDaySummarySchema),
  // Alias for orchestrator_cost_usd to match legacy CI consumers.
  total_cost_usd: z.number().nonnegative(),
});
export type AgenticRunSummary = z.infer<typeof AgenticRunSummarySchema>;

export interface RunAgenticPipelineOptions {
  /** Defaults to `loadBrand()`. */
  brand?: Brand;
  /** Defaults to ISO week of `today` or `new Date()`. */
  week?: string;
  /** Defaults to `<cwd>/data`. */
  dataDir?: string;
  /** Defaults to `<cwd>/drafts`. */
  draftsRoot?: string;
  /** Defaults to `<cwd>/QUALITY.md`. */
  qualityPath?: string;
  /** Defaults to `<cwd>/logs/<week>/agentic-pipeline.log`. */
  logFilePath?: string;
  /**
   * Anthropic client. Optional ONLY when `orchestratorOverride` is provided
   * (tests supply a synthetic OrchestratorResult and never hit the network).
   * When the real orchestrator runs, `client` is required.
   */
  client?: Anthropic;
  /** Test seam: provide a synthetic OrchestratorResult instead of running for real. */
  orchestratorOverride?: (params: {
    client?: Anthropic;
    brand: Brand;
    week: string;
    dataDir: string;
  }) => Promise<OrchestratorResult>;
  /** Optional clock for deterministic tests. */
  today?: Date;
  /**
   * Test seam: inject a preconfigured logger (e.g. `makeLogger({ sync: true })`
   * or a spy) instead of letting the pipeline construct the default pino
   * logger. Bypasses `logFilePath` entirely when set.
   */
  loggerOverride?: Logger;
}

export interface RunAgenticPipelineResult {
  summary: AgenticRunSummary;
  /** 0 = success (even with skipped days), 1 = total failure / all skipped. */
  exitCode: 0 | 1;
}

/**
 * Top-level orchestration:
 *   1. Run the multi-agent orchestrator.
 *   2. Apply the deterministic voice gate as a final pass on each approved draft.
 *   3. Materialize drafts/<week>/<day>.md (or .SKIPPED.md) on disk.
 *   4. Write data/runs/<week>.json + append a row to QUALITY.md.
 *
 * Returns `{ summary, exitCode }`. The CLI wrapper (`main()` below) sets
 * `process.exitCode = exitCode` so callers can chain assertions in tests
 * without forcibly killing the worker.
 */
export async function runAgenticPipeline(
  opts: RunAgenticPipelineOptions = {},
): Promise<RunAgenticPipelineResult> {
  const today = opts.today ?? new Date();
  const week = opts.week ?? computeIsoWeek(today);
  const dataDir = opts.dataDir ?? join(REPO_ROOT, 'data');
  const draftsRoot = opts.draftsRoot ?? join(REPO_ROOT, 'drafts');
  const qualityPath = opts.qualityPath ?? join(REPO_ROOT, 'QUALITY.md');
  const logFilePath =
    opts.logFilePath ?? join(REPO_ROOT, 'logs', week, 'agentic-pipeline.log');

  const log =
    opts.loggerOverride ??
    makeLogger({ name: 'agentic-pipeline', filePath: logFilePath });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const brand = opts.brand ?? loadBrand();

  // Client contract: required unless an orchestratorOverride is provided.
  // We refuse to silently pass `undefined as Anthropic` — that only NPEs in
  // prod. Tests that stub the orchestrator may omit both; real callers must
  // pass one.
  if (!opts.client && !opts.orchestratorOverride) {
    throw new Error(
      'agentic-pipeline: either client or orchestratorOverride is required',
    );
  }
  // Only construct a live client when we're going to run the real orchestrator.
  // If an override is set, we leave `client` undefined to avoid needing
  // ANTHROPIC_API_KEY in tests.
  const client: Anthropic | undefined = opts.orchestratorOverride
    ? opts.client
    : (opts.client ?? makeClient());

  let orchestratorResult: OrchestratorResult;
  let unexpectedError: Error | undefined;
  try {
    if (opts.orchestratorOverride) {
      orchestratorResult = await opts.orchestratorOverride({
        client,
        brand,
        week,
        dataDir,
      });
    } else {
      // Unreachable without a client per the contract above; the `!` is
      // justified because we threw when both client and override were absent.
      orchestratorResult = await runOrchestrator({
        client: client!,
        brand,
        week,
        dataDir,
        today,
      });
    }
  } catch (err) {
    unexpectedError = err instanceof Error ? err : new Error(String(err));
    log.error(
      { err: unexpectedError.message, stack: unexpectedError.stack },
      'agentic-pipeline: orchestrator threw',
    );
    // Build a synthetic all-skipped result so we still write summary + SKIPPED files.
    orchestratorResult = {
      week,
      days: (['mon', 'wed', 'fri'] as const).map((d) => ({
        day: d,
        draft: {},
        critic_verdict: {
          day: d,
          verdict: 'fix',
          severity: 'block',
          reasons: [`pipeline error: ${unexpectedError!.message}`],
          specific_fixes: [],
        },
        retries: 0,
        approved: false,
        skipped: true,
      })),
      scout_source: 'web_search',
      cost_usd: 0,
      wall_ms: Date.now() - t0,
      aborted: true,
      abort_reason: `pipeline_error: ${unexpectedError.message}`,
    };
  }

  // ── FS containment ───────────────────────────────────────────────────────
  // Per-day writes happen inside `handleDay`, which now swallows fs errors
  // and marks the day as `fs_error`. The summary + QUALITY.md writes below
  // are wrapped in try/finally so a bug in one does not prevent the other.

  try {
    mkdirSync(join(draftsRoot, week), { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ week, err: msg }, 'agentic-pipeline: mkdir drafts dir failed');
    // Continue — each per-day write will also fail and be marked fs_error.
  }

  const dayResults: AgenticDaySummary[] = [];
  let produced = 0;
  let skipped = 0;

  for (const dayResult of orchestratorResult.days) {
    const summary = handleDay({
      dayResult,
      brand,
      week,
      draftsRoot,
      aborted: orchestratorResult.aborted,
      abortReason: orchestratorResult.abort_reason,
      log,
    });
    dayResults.push(summary);
    if (summary.status === 'published') produced++;
    else skipped++;
  }

  const finishedAt = new Date().toISOString();
  const summary: AgenticRunSummary = AgenticRunSummarySchema.parse({
    week,
    started_at: startedAt,
    finished_at: finishedAt,
    scout_source: orchestratorResult.scout_source,
    orchestrator_cost_usd: orchestratorResult.cost_usd,
    wall_ms: orchestratorResult.wall_ms,
    aborted: orchestratorResult.aborted,
    abort_reason: orchestratorResult.abort_reason,
    drafts_produced: produced,
    drafts_skipped: skipped,
    days: dayResults,
    total_cost_usd: orchestratorResult.cost_usd,
  });

  // Always attempt the summary + QUALITY writes, even if something earlier
  // threw. Each is individually try/caught so one failure does not stop the
  // other.
  try {
    try {
      const runDir = join(dataDir, 'runs');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, `${week}.json`),
        JSON.stringify(summary, null, 2),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ week, err: msg }, 'agentic-pipeline: summary write failed');
    }
  } finally {
    try {
      appendQualityRow({ summary, qualityPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ week, err: msg }, 'agentic-pipeline: QUALITY.md append failed');
    }
  }

  log.info(
    {
      week,
      drafts_produced: produced,
      drafts_skipped: skipped,
      cost_usd: orchestratorResult.cost_usd,
      aborted: orchestratorResult.aborted,
      abort_reason: orchestratorResult.abort_reason,
    },
    'agentic-pipeline: run complete',
  );

  // Exit code: 1 only if EVERY day was skipped or an unexpected exception was thrown.
  const allSkipped = produced === 0;
  const exitCode: 0 | 1 = allSkipped || unexpectedError !== undefined ? 1 : 0;

  return { summary, exitCode };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-day handler: voice gate + file emission
// ────────────────────────────────────────────────────────────────────────────

interface HandleDayParams {
  dayResult: DayRunResult;
  brand: Brand;
  week: string;
  draftsRoot: string;
  aborted: boolean;
  abortReason?: string;
  log: Logger;
}

/**
 * Deterministic punctuation cleanup. The drafter is instructed to avoid em
 * and en dashes, but Sonnet still leaks them through occasionally. Strip
 * them BEFORE the voice gate sees the text — this is a mechanical fix, not
 * a creative judgment, so doing it server-side is safer than another retry.
 */
function sanitizePunctuation(text: string): string {
  return text
    .replace(/\s+[—–]\s+/g, '. ')
    .replace(/[—–]/g, ', ');
}

/**
 * Deterministic banned-phrase scrubber. Every key here MUST also live in
 * brand.yaml voice.must_not_have.banned_phrases (the gate's source of truth).
 * The gate is what catches anything we miss; this map is the safety net that
 * keeps drafter slips from becoming SKIPPED drafts. Add a new phrase to brand
 * AND here together — if you forget the swap, the gate will fail loud.
 */
const BANNED_PHRASE_SWAPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgame[- ]?changer\b/gi, 'shift'],
  [/\bthought leader\b/gi, 'operator'],
  [/\bdeep dive\b/gi, 'look'],
  [/\bdelv(e|es|ed|ing)\b/gi, 'look at'],
  [/\bleverag(e|es|ed|ing)\b/gi, 'use'],
  [/\bsynerg(y|ies)\b/gi, 'fit'],
  [/\becosystem\b/gi, 'stack'],
  [/\bunpack(s|ed|ing)?\b/gi, 'examine'],
  [/\bunlock(s|ed|ing)?\b/gi, 'open up'],
  [/\bLet that sink in[.!?]?\s*/g, ''],
  [/\bHere'?s the thing[.,]?\s*/gi, ''],
];

function sanitizeBannedPhrases(text: string): string {
  let out = text;
  for (const [pattern, replacement] of BANNED_PHRASE_SWAPS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function sanitizePost(text: string): string {
  return sanitizeBannedPhrases(sanitizePunctuation(text));
}

function handleDay(p: HandleDayParams): AgenticDaySummary {
  const { dayResult, brand, week, draftsRoot, aborted, abortReason, log } = p;
  const day = dayResult.day;
  const draftAny = dayResult.draft as { post_text?: string; pillar?: string };
  const rawPostText = typeof draftAny.post_text === 'string' ? draftAny.post_text : '';
  const postText = sanitizePost(rawPostText);
  const pillar = typeof draftAny.pillar === 'string' ? draftAny.pillar : undefined;
  const cost =
    typeof (dayResult.draft as { cost_usd?: number }).cost_usd === 'number'
      ? (dayResult.draft as { cost_usd: number }).cost_usd
      : 0;

  // 1. Aborted runs and orchestrator-skipped days both go straight to .SKIPPED.md.
  if (aborted) {
    const reason = abortReason ?? 'unknown abort';
    const fsErr = writeSkipped({
      draftsRoot,
      week,
      day,
      title: 'aborted',
      body: `Run aborted: ${reason}`,
      meta: { retries: dayResult.retries, pillar },
      log,
    });
    if (fsErr) {
      return {
        day,
        status: 'skipped',
        reason: fsErr,
        reason_class: 'fs_error',
        retries: dayResult.retries,
        pillar,
      };
    }
    return {
      day,
      status: 'skipped',
      reason: `aborted: ${reason}`,
      reason_class: 'aborted',
      retries: dayResult.retries,
      pillar,
    };
  }

  if (dayResult.skipped) {
    const verdict = dayResult.critic_verdict;
    const reason =
      verdict.reasons.length > 0
        ? verdict.reasons.join('; ')
        : 'skipped (no reason recorded)';
    const fsErr = writeSkipped({
      draftsRoot,
      week,
      day,
      title: `${verdict.verdict}/${verdict.severity}`,
      body: `Critic block: ${reason}\n\nSpecific fixes:\n${
        verdict.specific_fixes.length > 0
          ? verdict.specific_fixes.map((f) => `- ${f}`).join('\n')
          : '(none)'
      }`,
      meta: { retries: dayResult.retries, pillar },
      log,
    });
    if (fsErr) {
      return {
        day,
        status: 'skipped',
        reason: fsErr,
        reason_class: 'fs_error',
        retries: dayResult.retries,
        pillar,
      };
    }
    return {
      day,
      status: 'skipped',
      reason: `critic_block: ${reason}`,
      reason_class: 'critic_block',
      retries: dayResult.retries,
      pillar,
    };
  }

  // 2. Approved by critic — but the deterministic voice gate is the final word.
  if (dayResult.approved) {
    const gateResult = runVoiceGate(postText, {
      brand,
      pillar: pillar ?? '',
    });
    if (!gateResult.pass) {
      // System-level bug: the orchestrator approved a draft that the
      // deterministic gate rejects. Log loud (error level) per spec; do NOT
      // publish.
      log.error(
        {
          day,
          failures: gateResult.failures,
          post_text: postText,
        },
        'agentic-pipeline: voice gate failed on critic-approved draft (system bug)',
      );
      const fsErr = writeSkipped({
        draftsRoot,
        week,
        day,
        title: 'gate_fail',
        body: `Voice gate failed AFTER critic approval (system bug):\n${gateResult.failures
          .map((f) => `- ${f}`)
          .join('\n')}\n\nDraft text:\n${postText}`,
        meta: { retries: dayResult.retries, pillar },
        log,
      });
      if (fsErr) {
        return {
          day,
          status: 'skipped',
          reason: fsErr,
          reason_class: 'fs_error',
          retries: dayResult.retries,
          pillar,
        };
      }
      return {
        day,
        status: 'skipped',
        reason: `gate_fail: ${gateResult.failures.join('; ')}`,
        reason_class: 'gate_fail',
        retries: dayResult.retries,
        pillar,
      };
    }

    // Gate passed — write the published draft.
    const wordCount = postText.split(/\s+/).filter(Boolean).length;
    const charCount = postText.length;
    const fmObj: Record<string, string | number> = {
      week,
      day,
      pillar: pillar ?? '',
      cost_usd: Number(cost.toFixed(6)),
      retries: dayResult.retries,
      word_count: wordCount,
      char_count: charCount,
    };
    const frontmatter = `---\n${stringifyYaml(fmObj)}---\n\n`;
    const targetPath = join(draftsRoot, week, `${day}.md`);
    try {
      writeFileSync(targetPath, `${frontmatter}${postText}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        { day, err: msg },
        'agentic-pipeline: per-day draft write failed',
      );
      return {
        day,
        status: 'skipped',
        reason: msg,
        reason_class: 'fs_error',
        retries: dayResult.retries,
        pillar,
      };
    }
    return {
      day,
      status: 'published',
      retries: dayResult.retries,
      pillar,
      word_count: wordCount,
      char_count: charCount,
    };
  }

  // Defensive — shouldn't reach here unless the orchestrator returned a
  // "neither approved nor skipped" day, which the schema rules out today.
  const fsErr = writeSkipped({
    draftsRoot,
    week,
    day,
    title: 'unknown',
    body: 'Day produced no terminal status (approved=false, skipped=false). Treating as skipped.',
    meta: { retries: dayResult.retries, pillar },
    log,
  });
  if (fsErr) {
    return {
      day,
      status: 'skipped',
      reason: fsErr,
      reason_class: 'fs_error',
      retries: dayResult.retries,
      pillar,
    };
  }
  return {
    day,
    status: 'skipped',
    reason: 'unknown_state',
    reason_class: 'unknown_state',
    retries: dayResult.retries,
    pillar,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// File helpers
// ────────────────────────────────────────────────────────────────────────────

interface WriteSkippedParams {
  draftsRoot: string;
  week: string;
  day: string;
  title: string;
  body: string;
  meta: { retries: number; pillar?: string };
  log: Logger;
}

/**
 * Writes the .SKIPPED.md sidecar. Returns undefined on success; returns the
 * error message string on fs failure (caller converts to `fs_error` reason).
 */
function writeSkipped(p: WriteSkippedParams): string | undefined {
  const path = join(p.draftsRoot, p.week, `${p.day}.SKIPPED.md`);
  const fmObj: Record<string, string | number> = {
    week: p.week,
    day: p.day,
    pillar: p.meta.pillar ?? '',
    retries: p.meta.retries,
    status: 'skipped',
    reason_class: p.title,
  };
  const content =
    `---\n${stringifyYaml(fmObj)}---\n\n# ${p.day} SKIPPED (${p.title})\n\n${p.body}\n`;
  try {
    writeFileSync(path, content);
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(
      { day: p.day, err: msg },
      'agentic-pipeline: per-day SKIPPED write failed',
    );
    return msg;
  }
}

interface AppendQualityRowParams {
  summary: AgenticRunSummary;
  qualityPath: string;
}

function appendQualityRow(p: AppendQualityRowParams): void {
  const headerRow =
    '| week | drafts | skipped | total_cost | duration_s |\n|---|---|---|---|---|\n';
  const durationS = p.summary.wall_ms / 1000;
  const row = `| ${p.summary.week} | ${p.summary.drafts_produced} | ${
    p.summary.drafts_skipped
  } | $${p.summary.orchestrator_cost_usd.toFixed(2)} | ${durationS.toFixed(1)} |\n`;
  try {
    const existing = readFileSync(p.qualityPath, 'utf8');
    writeFileSync(p.qualityPath, existing + row);
  } catch {
    writeFileSync(p.qualityPath, `# QUALITY\n\n${headerRow}${row}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const { exitCode } = await runAgenticPipeline({ client: makeClient() });
    process.exitCode = exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[agentic-pipeline] fatal: ${msg}${stack ? '\n' + stack : ''}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
