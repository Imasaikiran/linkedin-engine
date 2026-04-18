import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AngleSchema, PillarEnum, DayEnum } from '../lib/schema.js';
import type { Angle, ScoredCluster } from '../lib/schema.js';
import { embedTexts, cosine } from '../lib/embed.js';
import { complete } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';

export async function dedupeVsRecent(scored: ScoredCluster[], recentTopics: string[], threshold: number): Promise<ScoredCluster[]> {
  if (recentTopics.length === 0) return scored;
  const allTexts = [...scored.map((s) => s.topic), ...recentTopics];
  const vecs = await embedTexts(allTexts);
  const scoredVecs = vecs.slice(0, scored.length);
  const recentVecs = vecs.slice(scored.length);
  return scored.filter((_, i) => recentVecs.every((rv) => cosine(scoredVecs[i]!, rv) <= threshold));
}

const AnglesResponseSchema = z.object({
  angles: z.array(z.object({
    day: DayEnum,
    pillar: PillarEnum,
    cluster_topic: z.string(),
    cluster_urls: z.array(z.string().url()).min(1),
    one_line_angle: z.string(),
    why_this_pillar: z.string(),
  })).length(3),
});

export async function pickAngles(client: Anthropic, scored: ScoredCluster[], promptText: string): Promise<{ angles: Angle[]; cost_usd: number }> {
  const userPrompt = `${promptText}\n\nCLUSTERS:\n${JSON.stringify(scored.slice(0, 10).map((c) => ({
    topic: c.topic,
    urls: c.items.map((i) => i.url),
    source_count: c.source_count,
    final_score: c.final_score,
  })), null, 2)}`;
  const res = await complete({ client, model: 'claude-sonnet-4-6', system: 'Respond with valid JSON only.', user: userPrompt, maxTokens: 1500 });
  const json = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  const parsed = AnglesResponseSchema.parse(json);
  return { angles: parsed.angles.map((a) => AngleSchema.parse(a)), cost_usd: res.cost_usd };
}

export async function runAngleStage(opts: { client: Anthropic; dataDir: string; week: string; promptPath: string; recentWeeksLookback?: number; dedupThreshold?: number }): Promise<{ angles: Angle[]; cost_usd: number }> {
  const log = makeLogger({ name: 'angle' });
  const scored = JSON.parse(readFileSync(join(opts.dataDir, 'scored', `${opts.week}.json`), 'utf8')) as ScoredCluster[];

  const lookback = opts.recentWeeksLookback ?? 4;
  const recentTopics: string[] = [];
  const angleDir = join(opts.dataDir, 'angles');
  if (existsSync(angleDir)) {
    const all = readdirSync(angleDir).filter((f) => f.endsWith('.json')).slice(-lookback);
    for (const f of all) {
      const arr = JSON.parse(readFileSync(join(angleDir, f), 'utf8')) as Angle[];
      for (const a of arr) recentTopics.push(a.cluster_topic);
    }
  }

  const deduped = await dedupeVsRecent(scored, recentTopics, opts.dedupThreshold ?? 0.85);
  log.info({ scored: scored.length, deduped: deduped.length }, 'angle input');

  const promptText = readFileSync(opts.promptPath, 'utf8');
  const { angles, cost_usd } = await pickAngles(opts.client, deduped, promptText);

  mkdirSync(angleDir, { recursive: true });
  writeFileSync(join(angleDir, `${opts.week}.json`), JSON.stringify(angles, null, 2));
  return { angles, cost_usd };
}
