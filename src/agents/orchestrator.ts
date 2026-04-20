import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Brand } from '../lib/brand.js';
import { BrandDayEnum } from '../lib/brand.js';
import { complete, extractJson, resolveModelId } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';
import { ClaimSchema, type ScoredCluster } from '../lib/schema.js';
import { runScout, type ScoutOutput, type ScoutSource, type TopicItem } from './scout.js';
import {
  runStrategist,
  type RecentAngleHint,
  type StrategistAngle,
} from './strategist.js';
import { runDrafter, type DrafterSource } from './drafter.js';
import {
  runCritic,
  runCriticOnce,
  CriticVerdictSchema,
  type CriticVerdict,
} from './critic.js';

const log = makeLogger({ name: 'orchestrator' });

// ---------- output schemas ----------
export const DayRunResultSchema = z.object({
  day: BrandDayEnum,
  /**
   * The final draft object. Typed as unknown here because the drafter returns
   * Draft objects whose `pillar` uses `brand.cadence` values ("shipped",
   * "critique") which the legacy `DraftSchema.pillar` PillarEnum rejects.
   * See `src/agents/drafter.ts` for the same parse-avoidance rationale.
   */
  draft: z.any(),
  critic_verdict: CriticVerdictSchema,
  retries: z.number().int().nonnegative(),
  /** true iff final verdict is 'approve' OR ('fix' with 'soft' severity). */
  approved: z.boolean(),
  /** true iff final verdict was 'fix' with 'block' severity after max retries (or aborted). */
  skipped: z.boolean(),
});
export type DayRunResult = z.infer<typeof DayRunResultSchema>;

export const OrchestratorResultSchema = z.object({
  week: z.string(),
  days: z.array(DayRunResultSchema).length(3),
  scout_source: z.enum(['web_search', 'rss_fallback']),
  cost_usd: z.number().nonnegative(),
  wall_ms: z.number().int().nonnegative(),
  aborted: z.boolean(),
  abort_reason: z.string().optional(),
});
export type OrchestratorResult = z.infer<typeof OrchestratorResultSchema>;

// ---------- input types ----------
type Day = 'mon' | 'wed' | 'fri';
const DAYS: readonly Day[] = ['mon', 'wed', 'fri'] as const;

export interface RunOrchestratorParams {
  client: Anthropic;
  brand: Brand;
  /** ISO week string, e.g. "2026-W16". Used to locate data/scored/<week>.json. */
  week: string;
  /** Repository data directory (e.g. <repo>/data). Used for clusters/angles/voice corpus. */
  dataDir: string;
  /** Optional clock for deterministic tests. Defaults to `new Date()`. */
  today?: Date;
  /** Override for tests. Default: load data/scored/<week>.json; empty + warn if missing. */
  clustersOverride?: ScoredCluster[];
  /** Override for tests. Default: scan data/angles/*.json (last 4 by filename). */
  recentAnglesOverride?: RecentAngleHint[];
  /** Override for tests. Default: sample from data/voice-corpus/external/*.txt. */
  voiceSamplesByDayOverride?: Record<Day, string[]>;
  /** Override for tests. Default: derive from scout + clusters matching angle.sources. */
  sourcesByDayOverride?: Record<Day, DrafterSource[]>;
}

// ---------- abort marker ----------
class OrchestratorAbort extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'OrchestratorAbort';
  }
}

// ---------- main ----------
export async function runOrchestrator(
  p: RunOrchestratorParams,
): Promise<OrchestratorResult> {
  const T0 = Date.now();
  const BUDGET_USD = p.brand.budgets.cost_usd_per_run;
  const TIME_BUDGET_MS = p.brand.budgets.wall_time_seconds * 1000;
  const MAX_RETRIES = p.brand.agents.max_retry_loops;

  let costSoFar = 0;
  let aborted = false;
  let abortReason: string | undefined;

  // Track what we have so we can build a partial result on abort.
  let scoutSource: ScoutSource = 'web_search';
  const draftsByDay: Partial<Record<Day, any>> = {};
  const verdictsByDay: Partial<Record<Day, CriticVerdict>> = {};
  const retriesByDay: Record<Day, number> = { mon: 0, wed: 0, fri: 0 };
  let angles: StrategistAngle[] = [];

  /**
   * Guarded step runner: checks wall-time + budget BEFORE invoking fn, runs it,
   * then folds its cost into the running total. Either guard breach throws
   * OrchestratorAbort, which `runOrchestrator` catches to build a partial result.
   */
  async function step<T extends { cost_usd?: number }>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    if (now - T0 > TIME_BUDGET_MS) {
      throw new OrchestratorAbort(
        `wall_time_exceeded before ${label} (${now - T0}ms > ${TIME_BUDGET_MS}ms)`,
      );
    }
    if (costSoFar > BUDGET_USD) {
      throw new OrchestratorAbort(
        `cost_exceeded before ${label} (${costSoFar.toFixed(4)} > ${BUDGET_USD})`,
      );
    }
    const tStep = Date.now();
    const res = await fn();
    const stepCost = typeof res.cost_usd === 'number' ? res.cost_usd : 0;
    costSoFar += stepCost;
    log.info(
      {
        label,
        step_cost_usd: stepCost,
        total_cost_usd: costSoFar,
        step_ms: Date.now() - tStep,
        wall_ms: Date.now() - T0,
      },
      'orchestrator step done',
    );
    return res;
  }

  try {
    // ---- 1. scout ----
    const scout = await step('scout', () => runScout({ client: p.client, brand: p.brand, today: p.today }));
    scoutSource = scout.source;

    // ---- 2. clusters + recentAngles ----
    const clusters = resolveClusters({
      override: p.clustersOverride,
      dataDir: p.dataDir,
      week: p.week,
    });
    const recentAngles = resolveRecentAngles({
      override: p.recentAnglesOverride,
      dataDir: p.dataDir,
    });

    // ---- 3. strategist ----
    const strategist = await step('strategist', () =>
      runStrategist({
        client: p.client,
        brand: p.brand,
        scout,
        clusters,
        recentAngles,
      }),
    );
    angles = strategist.angles;

    // ---- 4. sourcesByDay + voiceSamplesByDay ----
    const sourcesByDay =
      p.sourcesByDayOverride ??
      buildSourcesByDay({ angles, scout, clusters });
    const voiceSamplesByDay =
      p.voiceSamplesByDayOverride ??
      loadVoiceSamples({ dataDir: p.dataDir, brand: p.brand });

    // ---- 5. initial drafter + critic (parallel fan-out) ----
    const drafterResult = await step('drafter', () =>
      runDrafter({
        client: p.client,
        brand: p.brand,
        angles,
        sourcesByDay,
        voiceSamplesByDay,
      }),
    );
    for (const r of drafterResult.results) {
      draftsByDay[r.day] = r.draft;
    }

    const criticResult = await step('critic', () =>
      runCritic({
        client: p.client,
        brand: p.brand,
        drafts: drafterResult.results.map((r) => ({
          day: r.day,
          draft: { post_text: r.draft.post_text, pillar: r.draft.pillar },
        })),
      }),
    );
    for (const v of criticResult.verdicts) {
      verdictsByDay[v.day] = v;
    }

    // ---- 6. retry loop ----
    for (let loopIdx = 0; loopIdx < MAX_RETRIES; loopIdx++) {
      // Pre-loop guards: bail early if budget/time already blown.
      if (Date.now() - T0 > TIME_BUDGET_MS) {
        throw new OrchestratorAbort(
          `wall_time_exceeded before retry loop ${loopIdx} (${Date.now() - T0}ms > ${TIME_BUDGET_MS}ms)`,
        );
      }
      if (costSoFar > BUDGET_USD) {
        throw new OrchestratorAbort(
          `cost_exceeded before retry loop ${loopIdx} (${costSoFar.toFixed(4)} > ${BUDGET_USD})`,
        );
      }

      const daysNeedingFix: Day[] = DAYS.filter((d) => {
        const v = verdictsByDay[d];
        return v !== undefined && v.verdict === 'fix' && v.severity === 'block';
      });
      if (daysNeedingFix.length === 0) break;

      log.info(
        { loop: loopIdx, days: daysNeedingFix },
        'orchestrator: surgical retry pass',
      );

      // 6a. Surgical retries in parallel.
      const retryDrafts = await Promise.all(
        daysNeedingFix.map((d) =>
          surgicalRetry({
            client: p.client,
            brand: p.brand,
            angle: findAngle(angles, d),
            prevDraft: draftsByDay[d],
            verdict: verdictsByDay[d] as CriticVerdict,
            sources: sourcesByDay[d] ?? [],
            voiceSamples: voiceSamplesByDay[d] ?? [],
          }),
        ),
      );
      for (let i = 0; i < daysNeedingFix.length; i++) {
        const d = daysNeedingFix[i]!;
        const newDraft = retryDrafts[i]!;
        // `cost_usd` on the returned draft is cumulative (prev + delta, matching
        // the drafter's convention). We only want to add the retry's delta to
        // the orchestrator's running cost, so we track the delta separately.
        const stepCost =
          typeof newDraft.__retry_step_cost_usd === 'number'
            ? newDraft.__retry_step_cost_usd
            : 0;
        // Drop the private marker before handing the draft back to callers.
        delete newDraft.__retry_step_cost_usd;
        draftsByDay[d] = newDraft;
        retriesByDay[d] += 1;
        costSoFar += stepCost;
      }

      // 6b. Re-critique only the retried days. `runCritic` requires length 3,
      // so we fan out `runCriticOnce` manually for the subset.
      const reCritic = await Promise.all(
        daysNeedingFix.map((d) =>
          runCriticOnce({
            client: p.client,
            brand: p.brand,
            draft: {
              post_text: (draftsByDay[d] as { post_text: string }).post_text,
              pillar: (draftsByDay[d] as { pillar: string }).pillar,
            },
            day: d,
          }),
        ),
      );
      for (let i = 0; i < daysNeedingFix.length; i++) {
        const d = daysNeedingFix[i]!;
        const r = reCritic[i]!;
        verdictsByDay[d] = r.verdict;
        costSoFar += r.cost_usd;
      }

      log.info(
        {
          loop: loopIdx,
          total_cost_usd: costSoFar,
          verdicts: daysNeedingFix.map((d) => ({
            day: d,
            verdict: verdictsByDay[d]?.verdict,
            severity: verdictsByDay[d]?.severity,
          })),
        },
        'orchestrator: retry pass complete',
      );
    }
  } catch (err) {
    aborted = true;
    if (err instanceof OrchestratorAbort) {
      abortReason = err.reason.startsWith('wall_time')
        ? 'wall_time_exceeded'
        : err.reason.startsWith('cost')
          ? 'cost_exceeded'
          : err.reason;
    } else {
      abortReason = err instanceof Error ? err.message : String(err);
    }
    log.warn({ abort_reason: abortReason, wall_ms: Date.now() - T0, cost_usd: costSoFar }, 'orchestrator aborted');
  }

  // ---- 7. Build per-day results ----
  const days: DayRunResult[] = DAYS.map((d) => {
    const v = verdictsByDay[d];
    const draft = draftsByDay[d] ?? {};
    if (aborted && v === undefined) {
      // Missing verdict altogether — synthesize a placeholder.
      return {
        day: d,
        draft,
        critic_verdict: {
          day: d,
          verdict: 'fix',
          severity: 'block',
          reasons: [`aborted: ${abortReason ?? 'unknown'}`],
          specific_fixes: [],
        } satisfies CriticVerdict,
        retries: retriesByDay[d],
        approved: false,
        skipped: true,
      };
    }
    if (v === undefined) {
      // Defensive: should never happen outside abort; treat as skipped.
      return {
        day: d,
        draft,
        critic_verdict: {
          day: d,
          verdict: 'fix',
          severity: 'block',
          reasons: ['no critic verdict recorded'],
          specific_fixes: [],
        } satisfies CriticVerdict,
        retries: retriesByDay[d],
        approved: false,
        skipped: true,
      };
    }
    const softApproved = v.verdict === 'fix' && v.severity === 'soft';
    const approved = v.verdict === 'approve' || softApproved;
    return {
      day: d,
      draft,
      critic_verdict: v,
      retries: retriesByDay[d],
      approved: approved && !aborted,
      skipped: !approved || aborted,
    };
  });

  const result = OrchestratorResultSchema.parse({
    week: p.week,
    days,
    scout_source: scoutSource,
    cost_usd: costSoFar,
    wall_ms: Date.now() - T0,
    aborted,
    abort_reason: abortReason,
  });

  log.info(
    {
      week: p.week,
      cost_usd: result.cost_usd,
      wall_ms: result.wall_ms,
      aborted: result.aborted,
      approved_days: result.days.filter((d) => d.approved).length,
      skipped_days: result.days.filter((d) => d.skipped).length,
      retries: result.days.map((d) => ({ day: d.day, retries: d.retries })),
    },
    'orchestrator: run complete',
  );

  return result;
}

// ---------- surgical retry ----------
/**
 * Local draft payload schema — mirrors `LlmDraftPayloadSchema` in drafter.ts.
 * We re-declare here (not import) because drafter.ts deliberately does not
 * export it, and we want to keep the orchestrator's retry prompt self-contained
 * rather than widen the drafter module's surface area.
 */
const SurgicalDraftPayloadSchema = z.object({
  post_text: z.string().min(1),
  claims: z.array(ClaimSchema),
  pillar: z.string().min(1),
  angle_rationale: z.string(),
});

interface SurgicalRetryParams {
  client: Anthropic;
  brand: Brand;
  angle: StrategistAngle;
  prevDraft: any;
  verdict: CriticVerdict;
  sources: DrafterSource[];
  voiceSamples: string[];
}

async function surgicalRetry(p: SurgicalRetryParams): Promise<any> {
  const cfg = p.brand.agents.drafter;
  const cad = p.brand.cadence[p.angle.day];

  const bannedPhrases = p.brand.voice.must_not_have.banned_phrases
    .map((s) => `  - "${s}"`)
    .join('\n');

  const system = [
    'You are Drafter, performing a SURGICAL edit on a previously rejected LinkedIn draft.',
    '',
    'Your previous draft was REJECTED by a Senior PM critic. You must make MINIMAL edits',
    'that fix ONLY the issues listed below. Preserve all other words, sentence order, and',
    'paragraph breaks wherever possible. Do not rewrite the draft from scratch.',
    '',
    `PILLAR (must stay "${cad.pillar}" exactly):`,
    cad.template,
    '',
    'BANNED PHRASES (still apply):',
    bannedPhrases,
    '',
    'Output a SINGLE JSON object. Same shape as before: { post_text, claims[], pillar, angle_rationale }.',
    'No preamble, no code fences. JSON only.',
  ].join('\n');

  const prevPayload = {
    post_text: (p.prevDraft as { post_text?: string }).post_text ?? '',
    claims: (p.prevDraft as { claims?: unknown[] }).claims ?? [],
    pillar: (p.prevDraft as { pillar?: string }).pillar ?? p.angle.pillar,
    angle_rationale: (p.prevDraft as { angle_rationale?: string }).angle_rationale ?? '',
  };

  const reasonsBlock = p.verdict.reasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n');
  const fixesBlock =
    p.verdict.specific_fixes.length > 0
      ? p.verdict.specific_fixes.map((f, i) => `  ${i + 1}. ${f}`).join('\n')
      : '  (none provided — infer minimal fixes from reasons)';

  const user = `DAY: ${p.angle.day}
PILLAR: ${cad.pillar}

REJECTION REASONS (from Senior PM critic):
${reasonsBlock}

REQUIRED SPECIFIC FIXES:
${fixesBlock}

PREVIOUS DRAFT (your starting point — preserve everything not flagged above):
${JSON.stringify(prevPayload, null, 2)}

Make the MINIMAL edits needed to resolve the reasons + fixes. Return the full
corrected JSON draft, same shape. pillar MUST remain "${cad.pillar}". JSON only.`;

  const res = await complete({
    client: p.client,
    model: resolveModelId(cfg.model),
    system,
    user,
    maxTokens: cfg.max_tokens,
    temperature: 0.4,
  });

  const parsed = extractJson(res.text);
  if (parsed === null) {
    throw new Error(
      `orchestrator.surgicalRetry: LLM returned no parseable JSON (day=${p.angle.day}). Raw text (first 800 chars):\n${res.text.slice(0, 800)}`,
    );
  }

  const v = SurgicalDraftPayloadSchema.safeParse(parsed);
  if (!v.success) {
    throw new Error(
      `orchestrator.surgicalRetry: LLM JSON failed schema (day=${p.angle.day}): ${JSON.stringify(v.error.issues)}`,
    );
  }

  if (v.data.pillar !== p.angle.pillar) {
    throw new Error(
      `orchestrator.surgicalRetry: pillar drift (day=${p.angle.day}): expected "${p.angle.pillar}", got "${v.data.pillar}"`,
    );
  }

  const prevAttempt = (p.prevDraft as { attempt?: number }).attempt ?? 0;
  const prevCost = (p.prevDraft as { cost_usd?: number }).cost_usd ?? 0;

  return {
    post_text: v.data.post_text,
    claims: v.data.claims,
    pillar: v.data.pillar,
    angle_rationale: v.data.angle_rationale,
    attempt: prevAttempt + 1,
    cost_usd: prevCost + res.cost_usd,
    // Expose the step cost so the orchestrator can fold it into its running total.
    // (The drafter stores the *cumulative* cost in `cost_usd`; we need the delta.)
    __retry_step_cost_usd: res.cost_usd,
  };
}

// ---------- helpers: clusters + recent angles ----------
function resolveClusters(p: {
  override?: ScoredCluster[];
  dataDir: string;
  week: string;
}): ScoredCluster[] {
  if (p.override) return p.override;
  const candidate = path.join(p.dataDir, 'scored', `${p.week}.json`);
  if (!existsSync(candidate)) {
    log.warn(
      { path: candidate },
      'orchestrator: no scored clusters file; proceeding with empty clusters',
    );
    return [];
  }
  try {
    const raw = readFileSync(candidate, 'utf8');
    const arr = JSON.parse(raw) as ScoredCluster[];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    log.warn(
      { path: candidate, err: err instanceof Error ? err.message : String(err) },
      'orchestrator: failed to read scored clusters; using empty array',
    );
    return [];
  }
}

function resolveRecentAngles(p: {
  override?: RecentAngleHint[];
  dataDir: string;
}): RecentAngleHint[] {
  if (p.override) return p.override;
  const angleDir = path.join(p.dataDir, 'angles');
  if (!existsSync(angleDir)) return [];
  try {
    const files = readdirSync(angleDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .slice(-4);
    const out: RecentAngleHint[] = [];
    for (const f of files) {
      try {
        const raw = readFileSync(path.join(angleDir, f), 'utf8');
        const arr = JSON.parse(raw) as Array<{
          day?: string;
          cluster_topic?: string;
          one_line_angle?: string;
          hook_idea?: string;
        }>;
        if (!Array.isArray(arr)) continue;
        for (const a of arr) {
          out.push({
            day: a.day ?? '',
            cluster_topic: a.cluster_topic,
            hook_idea: a.hook_idea ?? a.one_line_angle,
          });
        }
      } catch {
        // Skip malformed angle files silently; they are hints, not required.
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- helpers: sources ----------
function buildSourcesByDay(p: {
  angles: StrategistAngle[];
  scout: ScoutOutput;
  clusters: ScoredCluster[];
}): Record<Day, DrafterSource[]> {
  // Index bodies by URL from every place we have one.
  const bodyByUrl = new Map<string, string>();
  const indexTopic = (t: TopicItem): void => {
    if (t.url && !bodyByUrl.has(t.url)) bodyByUrl.set(t.url, t.summary);
  };
  p.scout.trending_topics.forEach(indexTopic);
  p.scout.recent_launches.forEach(indexTopic);
  for (const c of p.clusters) {
    for (const item of c.items) {
      if (!bodyByUrl.has(item.url)) bodyByUrl.set(item.url, item.body);
    }
  }

  const out: Record<Day, DrafterSource[]> = { mon: [], wed: [], fri: [] };
  for (const a of p.angles) {
    const day = a.day;
    const sources: DrafterSource[] = [];
    for (const url of a.sources) {
      sources.push({ url, body: bodyByUrl.get(url) ?? '' });
    }
    out[day] = sources;
  }
  return out;
}

// ---------- helpers: voice corpus ----------
function loadVoiceSamples(p: {
  dataDir: string;
  brand: Brand;
}): Record<Day, string[]> {
  const empty: Record<Day, string[]> = { mon: [], wed: [], fri: [] };
  const externalDir = path.join(p.dataDir, 'voice-corpus', 'external');
  if (!existsSync(externalDir)) {
    log.warn(
      { path: externalDir },
      'orchestrator: voice corpus dir missing; drafts will be voiceless',
    );
    return empty;
  }
  let files: string[];
  try {
    files = readdirSync(externalDir)
      .filter((f) => f.endsWith('.txt'))
      .filter((f) => {
        try {
          return statSync(path.join(externalDir, f)).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return empty;
  }
  if (files.length === 0) return empty;

  const samplesPerDraft = p.brand.sources.voice_corpus.samples_per_draft;
  const texts: string[] = [];
  for (const f of files) {
    try {
      texts.push(readFileSync(path.join(externalDir, f), 'utf8'));
    } catch {
      continue;
    }
  }
  if (texts.length === 0) return empty;

  // Same random-ish sample across all 3 days keeps behavior deterministic-ish
  // within a single process call (Math.random() still non-deterministic across runs).
  const pick = (): string[] => {
    const picked: string[] = [];
    const pool = [...texts];
    const n = Math.min(samplesPerDraft, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool[idx]!);
      pool.splice(idx, 1);
    }
    return picked;
  };

  return { mon: pick(), wed: pick(), fri: pick() };
}

// ---------- helpers: angles ----------
function findAngle(angles: StrategistAngle[], day: Day): StrategistAngle {
  const a = angles.find((x) => x.day === day);
  if (!a) throw new Error(`orchestrator: missing angle for day=${day}`);
  return a;
}
