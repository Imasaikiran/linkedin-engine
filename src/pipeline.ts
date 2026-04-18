import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
dayjs.extend(isoWeek);
import { runScrape } from './stages/scrape.js';
import { runCluster } from './stages/cluster.js';
import { runScore } from './stages/score.js';
import { runAngleStage } from './stages/angle.js';
import { runDraftStage } from './stages/draft.js';
import { runPolishStage } from './stages/polish.js';
import { makeClient, complete } from './lib/llm.js';
import { DraftSchema } from './lib/schema.js';
import type { Draft, RunSummary } from './lib/schema.js';
import { makeLogger } from './lib/log.js';

export function computeIsoWeek(d: Date): string {
  const w = dayjs(d).isoWeek();
  return `${dayjs(d).isoWeekYear()}-W${String(w).padStart(2, '0')}`;
}

const REPO_ROOT = process.cwd();

async function main(): Promise<void> {
  const log = makeLogger({ name: 'pipeline', filePath: join(REPO_ROOT, 'logs', `${computeIsoWeek(new Date())}/pipeline.log`) });
  const week = computeIsoWeek(new Date());
  const dataDir = join(REPO_ROOT, 'data');
  const sourcesYaml = readFileSync(join(REPO_ROOT, 'config', 'sources.yaml'), 'utf8');
  const client = makeClient();

  const summary: RunSummary = {
    week, started_at: new Date().toISOString(), stages: [], total_cost_usd: 0, drafts_produced: 0, drafts_skipped: 0,
  };
  const tStart = (s: string) => ({ s, t: Date.now() });
  const tEnd = (st: { s: string; t: number }, extras: Partial<{ llm_calls: number; cost_usd: number; ok: boolean; error: string }> = {}) => {
    summary.stages.push({ stage: st.s, duration_ms: Date.now() - st.t, llm_calls: extras.llm_calls ?? 0, cost_usd: extras.cost_usd ?? 0, ok: extras.ok ?? true, error: extras.error });
    summary.total_cost_usd += extras.cost_usd ?? 0;
  };

  try {
    let st = tStart('scrape');
    const scrape = await runScrape({ sourcesYaml, week, dataDir });
    tEnd(st, { ok: true });
    log.info({ counts: scrape.counts, errors: scrape.errors }, 'scrape done');

    st = tStart('cluster');
    await runCluster({ dataDir, week });
    tEnd(st);

    st = tStart('score');
    runScore({ dataDir, week });
    tEnd(st);

    st = tStart('angle');
    const angle = await runAngleStage({ client, dataDir, week, promptPath: join(REPO_ROOT, 'prompts', 'pick-angle.md') });
    tEnd(st, { llm_calls: 1, cost_usd: angle.cost_usd });

    st = tStart('draft');
    const draft = await runDraftStage({
      client, dataDir, week,
      voiceSystemPath: join(REPO_ROOT, 'prompts', 'voice-system.md'),
      pillarPromptDir: join(REPO_ROOT, 'prompts', 'pillars'),
      voiceCorpusDir: join(dataDir, 'voice-corpus'),
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
    log.error({ err: msg }, 'pipeline aborted');
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

async function makeRetry(client: ReturnType<typeof makeClient>, prev: Draft, info: { voice_failures: string[]; hallucination_failures: string[] }, attempt: number): Promise<Draft> {
  const instruction = attempt === 1
    ? `Your previous draft failed checks. Fix these issues:\nVoice failures: ${info.voice_failures.join('; ')}\nClaim failures: ${info.hallucination_failures.join('; ')}\n\nReturn corrected JSON.`
    : `Facts-only mode: only state what the sources literally say. Drop any unverifiable claim. Voice failures to fix: ${info.voice_failures.join('; ')}.`;
  const res = await complete({
    client, model: 'claude-sonnet-4-6', system: 'Return JSON only.',
    user: `${instruction}\n\nPREVIOUS DRAFT:\n${JSON.stringify(prev)}`,
    maxTokens: 1200,
  });
  const parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, '')) as unknown;
  return DraftSchema.parse({ ...(parsed as object), attempt, cost_usd: (prev.cost_usd ?? 0) + res.cost_usd });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
