import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
dayjs.extend(isoWeek);
import { parse as parseYaml } from 'yaml';
import { runScrape } from './stages/scrape.js';
import { runCluster } from './stages/cluster.js';
import { runScore } from './stages/score.js';
import { runAngleStage } from './stages/angle.js';
import { runDraftStage, extractJson } from './stages/draft.js';
import { runPolishStage } from './stages/polish.js';
import { makeClient, complete } from './lib/llm.js';
import { DraftSchema } from './lib/schema.js';
import type { Angle, Draft, Day, RunSummary } from './lib/schema.js';
import { makeLogger } from './lib/log.js';

export function computeIsoWeek(d: Date): string {
  const w = dayjs(d).isoWeek();
  return `${dayjs(d).isoWeekYear()}-W${String(w).padStart(2, '0')}`;
}

interface PillarsConfig {
  cadence: Record<Day, { pillars: string[]; word_count: [number, number] }>;
  voice_corpus?: { samples_per_draft?: number };
}

interface SkipDatesConfig {
  skip: { date: string; reason: string }[];
}

const DAY_OFFSET: Record<Day, number> = { mon: 0, wed: 2, fri: 4 };

export function dateForDay(week: string, day: Day): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`bad week format: ${week}`);
  const year = parseInt(m[1]!, 10);
  const wk = parseInt(m[2]!, 10);
  // Jan 4 is always in ISO week 1 of its iso-week-year, anchoring the lookup.
  const monday = dayjs(`${year}-01-04`).isoWeek(wk).isoWeekday(1).startOf('day');
  return monday.add(DAY_OFFSET[day], 'day').format('YYYY-MM-DD');
}

const REPO_ROOT = process.cwd();

async function main(): Promise<void> {
  const log = makeLogger({ name: 'pipeline', filePath: join(REPO_ROOT, 'logs', `${computeIsoWeek(new Date())}/pipeline.log`) });
  const week = computeIsoWeek(new Date());
  const dataDir = join(REPO_ROOT, 'data');
  const sourcesYaml = readFileSync(join(REPO_ROOT, 'config', 'sources.yaml'), 'utf8');
  const pillarsCfg = parseYaml(readFileSync(join(REPO_ROOT, 'config', 'pillars.yaml'), 'utf8')) as PillarsConfig;
  const skipDatesPath = join(REPO_ROOT, 'config', 'skip-dates.yaml');
  const skipMap = new Map<string, string>();
  if (existsSync(skipDatesPath)) {
    const cfg = parseYaml(readFileSync(skipDatesPath, 'utf8')) as SkipDatesConfig;
    for (const entry of cfg.skip ?? []) skipMap.set(entry.date, entry.reason);
  }
  const client = makeClient();

  const summary: RunSummary = {
    week, started_at: new Date().toISOString(), stages: [], total_cost_usd: 0, drafts_produced: 0, drafts_skipped: 0,
  };
  const tStart = (s: string) => ({ s, t: Date.now() });
  const tEnd = (st: { s: string; t: number }, extras: Partial<{ llm_calls: number; cost_usd: number; ok: boolean; error: string }> = {}) => {
    summary.stages.push({ stage: st.s, duration_ms: Date.now() - st.t, llm_calls: extras.llm_calls ?? 0, cost_usd: extras.cost_usd ?? 0, ok: extras.ok ?? true, error: extras.error });
    summary.total_cost_usd += extras.cost_usd ?? 0;
  };

  const MIN_ITEMS_TO_PROCEED = 5;

  try {
    let st = tStart('scrape');
    const scrape = await runScrape({ sourcesYaml, week, dataDir });
    tEnd(st, { ok: true });
    log.info({ counts: scrape.counts, errors: scrape.errors }, 'scrape done');

    const totalItems = Object.values(scrape.counts).reduce((a, b) => a + b, 0);
    if (totalItems < MIN_ITEMS_TO_PROCEED) {
      log.warn({ totalItems, threshold: MIN_ITEMS_TO_PROCEED }, 'too few scraped items, aborting run');
      const draftsRoot = join(REPO_ROOT, 'drafts');
      mkdirSync(join(draftsRoot, week), { recursive: true });
      for (const day of ['mon', 'wed', 'fri'] as const) {
        writeFileSync(join(draftsRoot, week, `${day}.SKIPPED.md`), `# ${day} SKIPPED\n\nReason: only ${totalItems} items scraped (need ${MIN_ITEMS_TO_PROCEED})\n`);
      }
      summary.drafts_skipped = 3;
      return;
    }

    st = tStart('cluster');
    await runCluster({ dataDir, week });
    tEnd(st);

    st = tStart('score');
    runScore({ dataDir, week });
    tEnd(st);

    st = tStart('angle');
    const angle = await runAngleStage({ client, dataDir, week, promptPath: join(REPO_ROOT, 'prompts', 'pick-angle.md') });
    tEnd(st, { llm_calls: 1, cost_usd: angle.cost_usd });

    const draftsRoot = join(REPO_ROOT, 'drafts');
    mkdirSync(join(draftsRoot, week), { recursive: true });
    const filtered = filterAngles(angle.angles, week, skipMap, pillarsCfg.cadence, draftsRoot, log);
    if (filtered.length < angle.angles.length) {
      writeFileSync(join(dataDir, 'angles', `${week}.json`), JSON.stringify(filtered, null, 2));
    }

    st = tStart('draft');
    const draft = await runDraftStage({
      client, dataDir, week,
      voiceSystemPath: join(REPO_ROOT, 'prompts', 'voice-system.md'),
      pillarPromptDir: join(REPO_ROOT, 'prompts', 'pillars'),
      voiceCorpusDir: join(dataDir, 'voice-corpus'),
      samplesPerDraft: pillarsCfg.voice_corpus?.samples_per_draft ?? 3,
    });
    tEnd(st, { llm_calls: Object.keys(draft.drafts).length, cost_usd: draft.cost_usd });

    st = tStart('polish');
    const polished = await runPolishStage({
      client, dataDir, week,
      draftsRoot: join(REPO_ROOT, 'drafts'),
      voiceCorpusDir: join(dataDir, 'voice-corpus'),
      retryFn: async (attempt, prev, info) => makeRetry(client, prev, info, attempt),
      maxRetries: 2,
    });
    tEnd(st, { llm_calls: 0 });

    summary.drafts_produced = Object.values(polished).filter((p) => !p.skipped).length;
    summary.drafts_skipped = Object.values(polished).filter((p) => p.skipped).length;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log.error({ err: msg, stack }, 'pipeline aborted');
    console.error(`[pipeline aborted] ${msg}${stack ? '\n' + stack : ''}`);
    summary.stages.push({ stage: 'aborted', duration_ms: 0, llm_calls: 0, cost_usd: 0, ok: false, error: msg });
    process.exitCode = 1;
  } finally {
    summary.finished_at = new Date().toISOString();
    const runDir = join(dataDir, 'runs');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `${week}.json`), JSON.stringify(summary, null, 2));
    appendQualityRow(summary);
    log.info({ summary }, 'pipeline done');
  }
}

export async function makeRetry(client: ReturnType<typeof makeClient>, prev: Draft, info: { voice_failures: string[]; hallucination_failures: string[] }, attempt: number): Promise<Draft> {
  const instruction = attempt === 1
    ? `Your previous draft failed checks. Fix these issues:\nVoice failures: ${info.voice_failures.join('; ')}\nClaim failures: ${info.hallucination_failures.join('; ')}\n\nReturn corrected JSON.`
    : `Facts-only mode: only state what the sources literally say. Drop any unverifiable claim. Voice failures to fix: ${info.voice_failures.join('; ')}.`;
  const res = await complete({
    client, model: 'claude-sonnet-4-6',
    system: 'Output ONLY a single JSON object. No preamble, no commentary, no code fences.',
    user: `${instruction}\n\nPREVIOUS DRAFT:\n${JSON.stringify(prev)}`,
    maxTokens: 1200,
  });
  const parsed = extractJson(res.text);
  if (parsed === null) {
    throw new Error(`makeRetry: LLM returned no parseable JSON. Raw text (first 800 chars):\n${res.text.slice(0, 800)}`);
  }
  return DraftSchema.parse({ ...(parsed as object), attempt, cost_usd: (prev.cost_usd ?? 0) + res.cost_usd });
}

function filterAngles(
  angles: Angle[],
  week: string,
  skipMap: Map<string, string>,
  cadence: PillarsConfig['cadence'],
  draftsRoot: string,
  log: ReturnType<typeof makeLogger>,
): Angle[] {
  const kept: Angle[] = [];
  for (const a of angles) {
    const date = dateForDay(week, a.day);
    const skipReason = skipMap.get(date);
    if (skipReason) {
      writeFileSync(join(draftsRoot, week, `${a.day}.SKIPPED.md`), `# ${a.day} SKIPPED\n\nReason: ${skipReason} (${date})\n`);
      log.info({ day: a.day, date, reason: skipReason }, 'skip-date hit, skipping draft');
      continue;
    }
    const allowed = cadence[a.day]?.pillars ?? [];
    if (allowed.length > 0 && !allowed.includes(a.pillar)) {
      writeFileSync(join(draftsRoot, week, `${a.day}.SKIPPED.md`), `# ${a.day} SKIPPED\n\nReason: cadence violation - LLM picked pillar "${a.pillar}" but ${a.day} allows ${allowed.join('|')}\n`);
      log.warn({ day: a.day, picked: a.pillar, allowed }, 'cadence violation, skipping draft');
      continue;
    }
    kept.push(a);
  }
  return kept;
}

function appendQualityRow(s: RunSummary): void {
  const path = join(REPO_ROOT, 'QUALITY.md');
  const headerRow = '| week | drafts | skipped | total_cost | duration_s |\n|---|---|---|---|---|\n';
  const totalDuration = s.stages.reduce((a, b) => a + b.duration_ms, 0) / 1000;
  const row = `| ${s.week} | ${s.drafts_produced} | ${s.drafts_skipped} | $${s.total_cost_usd.toFixed(2)} | ${totalDuration.toFixed(1)} |\n`;
  try {
    const existing = readFileSync(path, 'utf8');
    writeFileSync(path, existing + row);
  } catch {
    writeFileSync(path, `# QUALITY\n\n${headerRow}${row}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
