import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { DraftSchema } from '../lib/schema.js';
import type { Angle, Draft } from '../lib/schema.js';
import { complete } from '../lib/llm.js';

export interface BuildPromptParams {
  angle: Angle;
  pillarTemplate: string;
  sources: { url: string; body: string }[];
  voiceSamples: string[];
}

export function buildDraftPrompt(p: BuildPromptParams): string {
  const sourceBlock = p.sources.map((s) => `URL: ${s.url}\nBODY:\n${s.body.slice(0, 2000)}`).join('\n---\n');
  const samplesBlock = p.voiceSamples.map((s, i) => `SAMPLE ${i + 1}:\n${s}`).join('\n---\n');
  return `${p.pillarTemplate}

ANGLE: ${p.angle.one_line_angle}
WHY THIS PILLAR: ${p.angle.why_this_pillar}

SOURCES (use ONLY these for facts/quotes/stats/attributions):
${sourceBlock}

VOICE SAMPLES (mirror register/rhythm; do NOT reuse topics or phrasings):
${samplesBlock}

Now write the post per the rules. Output JSON only.`;
}

export interface RunDraftOnceParams {
  client: Anthropic;
  systemPrompt: string;
  userPrompt: string;
  attempt?: number;
}

export async function runDraftOnce(p: RunDraftOnceParams): Promise<Draft> {
  const res = await complete({
    client: p.client,
    model: 'claude-sonnet-4-6',
    system: p.systemPrompt,
    user: p.userPrompt,
    maxTokens: 1200,
    temperature: 0.7,
  });
  const cleaned = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
  const parsed = JSON.parse(cleaned);
  const draft = DraftSchema.parse({ ...parsed, attempt: p.attempt ?? 0, cost_usd: res.cost_usd });
  return draft;
}

export interface RunDraftStageParams {
  client: Anthropic;
  dataDir: string;
  week: string;
  voiceSystemPath: string;
  pillarPromptDir: string;
  voiceCorpusDir: string;
  samplesPerDraft?: number;
}

export async function runDraftStage(p: RunDraftStageParams): Promise<{ drafts: Record<string, Draft>; cost_usd: number }> {
  const angles = JSON.parse(readFileSync(join(p.dataDir, 'angles', `${p.week}.json`), 'utf8')) as Angle[];
  const clusters = JSON.parse(readFileSync(join(p.dataDir, 'clusters', `${p.week}.json`), 'utf8')) as { items: { url: string; body: string }[]; topic: string }[];
  const systemPrompt = readFileSync(p.voiceSystemPath, 'utf8');

  const drafts: Record<string, Draft> = {};
  let totalCost = 0;

  for (const angle of angles) {
    const pillarTemplate = readFileSync(join(p.pillarPromptDir, `${angle.pillar}.md`), 'utf8');
    const cluster = clusters.find((c) => angle.cluster_urls.some((u) => c.items.some((i) => i.url === u)));
    const sources = cluster?.items.map((i) => ({ url: i.url, body: i.body })) ?? [];
    const samples = pickVoiceSamples(p.voiceCorpusDir, angle.pillar, p.samplesPerDraft ?? 3);
    const userPrompt = buildDraftPrompt({ angle, pillarTemplate, sources, voiceSamples: samples });
    const draft = await runDraftOnce({ client: p.client, systemPrompt, userPrompt, attempt: 0 });
    drafts[angle.day] = draft;
    totalCost += draft.cost_usd;
  }

  const outDir = join(p.dataDir, 'drafts');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${p.week}.json`), JSON.stringify(drafts, null, 2));
  return { drafts, cost_usd: totalCost };
}

function pickVoiceSamples(corpusDir: string, _pillar: string, n: number): string[] {
  const externalDir = join(corpusDir, 'external');
  if (!existsSync(externalDir)) return [];
  const files = readdirSync(externalDir).filter((f) => f.endsWith('.txt'));
  const shuffled = files.sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map((f) => readFileSync(join(externalDir, f), 'utf8'));
}
