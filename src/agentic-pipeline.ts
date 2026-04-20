import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
dayjs.extend(isoWeek);
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

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
  /** Defaults to `makeClient()`. Tests inject a mock. */
  client?: Anthropic;
  /** Test seam: provide a synthetic OrchestratorResult instead of running for real. */
  orchestratorOverride?: (params: {
    client: Anthropic;
    brand: Brand;
    week: string;
    dataDir: string;
  }) => Promise<OrchestratorResult>;
  /** Optional clock for deterministic tests. */
  today?: Date;
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

  const log = makeLogger({ name: 'agentic-pipeline', filePath: logFilePath });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const brand = opts.brand ?? loadBrand();

  // Lazy-instantiate the client only if no orchestrator override is provided —
  // tests with `orchestratorOverride` should not need ANTHROPIC_API_KEY.
  const client = opts.client ?? (opts.orchestratorOverride ? (undefined as unknown as Anthropic) : makeClient());

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
      orchestratorResult = await runOrchestrator({
        client,
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

  mkdirSync(join(draftsRoot, week), { recursive: true });

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

  const runDir = join(dataDir, 'runs');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, `${week}.json`), JSON.stringify(summary, null, 2));
  appendQualityRow({ summary, qualityPath });

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
  log: ReturnType<typeof makeLogger>;
}

function handleDay(p: HandleDayParams): AgenticDaySummary {
  const { dayResult, brand, week, draftsRoot, aborted, abortReason, log } = p;
  const day = dayResult.day;
  const draftAny = dayResult.draft as { post_text?: string; pillar?: string };
  const postText = typeof draftAny.post_text === 'string' ? draftAny.post_text : '';
  const pillar = typeof draftAny.pillar === 'string' ? draftAny.pillar : undefined;
  const cost =
    typeof (dayResult.draft as { cost_usd?: number }).cost_usd === 'number'
      ? (dayResult.draft as { cost_usd: number }).cost_usd
      : 0;

  // 1. Aborted runs and orchestrator-skipped days both go straight to .SKIPPED.md.
  if (aborted) {
    const reason = abortReason ?? 'unknown abort';
    writeSkipped({
      draftsRoot,
      week,
      day,
      title: 'aborted',
      body: `Run aborted: ${reason}`,
      meta: { retries: dayResult.retries, pillar },
    });
    return {
      day,
      status: 'skipped',
      reason: `aborted: ${reason}`,
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
    writeSkipped({
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
    });
    return {
      day,
      status: 'skipped',
      reason: `critic_block: ${reason}`,
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
      writeSkipped({
        draftsRoot,
        week,
        day,
        title: 'gate_fail',
        body: `Voice gate failed AFTER critic approval (system bug):\n${gateResult.failures
          .map((f) => `- ${f}`)
          .join('\n')}\n\nDraft text:\n${postText}`,
        meta: { retries: dayResult.retries, pillar },
      });
      return {
        day,
        status: 'skipped',
        reason: `gate_fail: ${gateResult.failures.join('; ')}`,
        retries: dayResult.retries,
        pillar,
      };
    }

    // Gate passed — write the published draft.
    const wordCount = postText.split(/\s+/).filter(Boolean).length;
    const charCount = postText.length;
    const frontmatter = [
      '---',
      `week: ${week}`,
      `day: ${day}`,
      `pillar: ${pillar ?? ''}`,
      `cost_usd: ${cost.toFixed(6)}`,
      `retries: ${dayResult.retries}`,
      `word_count: ${wordCount}`,
      `char_count: ${charCount}`,
      '---',
      '',
    ].join('\n');
    writeFileSync(
      join(draftsRoot, week, `${day}.md`),
      `${frontmatter}${postText}\n`,
    );
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
  writeSkipped({
    draftsRoot,
    week,
    day,
    title: 'unknown',
    body: 'Day produced no terminal status (approved=false, skipped=false). Treating as skipped.',
    meta: { retries: dayResult.retries, pillar },
  });
  return {
    day,
    status: 'skipped',
    reason: 'unknown_state',
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
}

function writeSkipped(p: WriteSkippedParams): void {
  const path = join(p.draftsRoot, p.week, `${p.day}.SKIPPED.md`);
  const content = [
    '---',
    `week: ${p.week}`,
    `day: ${p.day}`,
    `pillar: ${p.meta.pillar ?? ''}`,
    `retries: ${p.meta.retries}`,
    `status: skipped`,
    `reason_class: ${p.title}`,
    '---',
    '',
    `# ${p.day} SKIPPED (${p.title})`,
    '',
    p.body,
    '',
  ].join('\n');
  writeFileSync(path, content);
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
    const { exitCode } = await runAgenticPipeline();
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
