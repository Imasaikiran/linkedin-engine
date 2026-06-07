import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Brand, BrandDay } from '../lib/brand.js';
import { complete, extractJson, resolveModelId } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';
import type { ScoredCluster } from '../lib/schema.js';
import { ScoutOutputSchema, type ScoutOutput } from '../agents/scout.js';

const log = makeLogger({ name: 'strategist' });

// ---------- output schema ----------
const DAY_VALUES = ['mon', 'wed', 'fri'] as const;

export const StrategistAngleSchema = z.object({
  day: z.enum(DAY_VALUES),
  pillar: z.string().min(1),
  hook_idea: z.string().min(1),
  why_it_works: z.string().min(1),
  sources: z.array(z.string().url()).min(1),
  cluster_topic: z.string().optional(),
});
export type StrategistAngle = z.infer<typeof StrategistAngleSchema>;

export const StrategistOutputSchema = z.object({
  angles: z.array(StrategistAngleSchema).length(3),
  cost_usd: z.number().nonnegative(),
});
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;

// LLM-returned shape (cost is server-side).
const LlmStrategistPayloadSchema = z.object({
  angles: z.array(StrategistAngleSchema).length(3),
});

// ---------- input types ----------
export interface RecentAngleHint {
  day: string;
  cluster_topic?: string;
  hook_idea?: string;
}

export interface RunStrategistParams {
  client: Anthropic;
  brand: Brand;
  scout: ScoutOutput;
  /** Existing scored clusters from the legacy scrape pipeline. May be empty. */
  clusters: ScoredCluster[];
  /** Last 4 weeks of picked angles for dedupe. Defaults to []. */
  recentAngles?: RecentAngleHint[];
}

// ---------- error type ----------
/**
 * Thrown when the LLM returns a payload we cannot validate, OR when the
 * angles violate the per-day pillar contract from `brand.cadence`.
 * A schema or pillar mismatch is a contract violation that callers should
 * surface loudly rather than retry blindly.
 */
export class StrategistSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategistSchemaError';
  }
}

// ---------- prompt assembly ----------
const SYSTEM_PROMPT_BASE = [
  'You are the Strategist, the editorial lead for a LinkedIn content engine.',
  'Your job: turn fresh research (scout findings + scored topic clusters) into',
  'three publish-ready angles for the week, one per cadence day (mon, wed, fri).',
  'Each angle becomes a brief for a downstream Drafter agent.',
  '',
  'You optimize for: a strong point of view, contrarian-but-charitable takes,',
  'specificity (named products, specific numbers), and angles the target',
  'audience would screenshot or save.',
  '',
  'IMPORTANT: Output ONLY a single JSON object. No preamble, no commentary, no code fences.',
].join('\n');

export function buildStrategistSystemPrompt(brand: Brand): string {
  const audience = brand.identity.audience.primary;
  const positioning = brand.identity.positioning;
  const cadenceLines = DAY_VALUES.map((d) => {
    const day = brand.cadence[d];
    return `- ${d}: pillar="${day.pillar}"; requires=[${day.requires.join(', ')}]`;
  }).join('\n');
  const hookPatterns = brand.engagement.hook_patterns
    .map((p, i) => `  ${i + 1}. ${p}`)
    .join('\n');
  const hookMaxWords = brand.voice.rhythm.hook_max_words;

  return [
    SYSTEM_PROMPT_BASE,
    '',
    `AUDIENCE: ${audience}`,
    `POSITIONING: ${positioning}`,
    '',
    'CADENCE (one angle per day, pillars are MANDATORY and must match exactly):',
    cadenceLines,
    '',
    'HOOK RHYTHM (hook_idea must echo one of these patterns):',
    hookPatterns,
    `Hook max words: ${hookMaxWords} (line-1 contender; ≤15 words hard cap).`,
  ].join('\n');
}

export function buildStrategistUserPrompt(p: {
  scout: ScoutOutput;
  clusters: ScoredCluster[];
  recentAngles: RecentAngleHint[];
}): string {
  // Drop server-only fields from scout before passing to the model.
  const scoutForPrompt = {
    trending_topics: p.scout.trending_topics,
    recent_launches: p.scout.recent_launches,
    engagement_signals: p.scout.engagement_signals,
  };

  // Truncate clusters to top 10 by final_score, keeping only what the model needs.
  const topClusters = [...p.clusters]
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, 10)
    .map((c) => ({
      topic: c.topic,
      final_score: c.final_score,
      source_count: c.source_count,
      urls: c.items.map((i) => i.url),
    }));

  return `SCOUT:
${JSON.stringify(scoutForPrompt, null, 2)}

CLUSTERS (top 10 by final_score):
${JSON.stringify(topClusters, null, 2)}

RECENT_ANGLES (last 4 weeks; do NOT repeat these topics or hooks):
${JSON.stringify(p.recentAngles, null, 2)}

Pick exactly 3 angles, one per day (mon, wed, fri). Respond with JSON only, matching:

{
  "angles": [
    {
      "day": "mon" | "wed" | "fri",
      "pillar": "<must equal brand.cadence[day].pillar>",
      "hook_idea": "<=15 words, contradiction or specific number",
      "why_it_works": "1-2 sentences mapping to the audience",
      "sources": ["https://..."],
      "cluster_topic": "optional; only if angle came from a cluster"
    }
  ]
}

Hard rules:
- Output JSON only. No prose. No code fences.
- Exactly 3 angles, one per day.
- pillar MUST equal the brand-configured pillar for that day.
- sources MUST be real URLs taken from SCOUT or CLUSTERS (do not invent).
- Avoid topics/hooks listed under RECENT_ANGLES (paraphrase OK only if hook is genuinely new).
`;
}

// ---------- main entry point ----------
export async function runStrategist(p: RunStrategistParams): Promise<StrategistOutput> {
  // Fail fast if scout payload was tampered with; this also normalizes optional fields.
  ScoutOutputSchema.parse(p.scout);

  const cfg = p.brand.agents.strategist;
  const recentAngles = p.recentAngles ?? [];

  const systemPrompt = buildStrategistSystemPrompt(p.brand);
  const userPrompt = buildStrategistUserPrompt({
    scout: p.scout,
    clusters: p.clusters,
    recentAngles,
  });

  const res = await complete({
    client: p.client,
    model: resolveModelId(cfg.model),
    system: systemPrompt,
    user: userPrompt,
    maxTokens: cfg.max_tokens,
    temperature: 0.7,
  });

  const parsed = extractJson(res.text);
  if (parsed === null) {
    throw new StrategistSchemaError(
      `strategist: LLM returned no parseable JSON. Raw text (first 800 chars):\n${res.text.slice(0, 800)}`,
    );
  }

  const v = LlmStrategistPayloadSchema.safeParse(parsed);
  if (!v.success) {
    const payload = JSON.stringify(parsed).slice(0, 800);
    throw new StrategistSchemaError(
      `strategist: LLM JSON failed schema validation: ${JSON.stringify(v.error.issues)}\npayload: ${payload}`,
    );
  }

  // Pillar-consistency check: schema alone cannot verify the per-day pillar
  // matches brand.cadence (the schema only says pillar is a non-empty string).
  // We enforce it here so contract violations fail loudly before reaching the drafter.
  enforcePillarConsistency(v.data.angles, p.brand);

  // Day-coverage check: exactly one angle per day.
  enforceDayCoverage(v.data.angles);

  log.info(
    {
      angles: v.data.angles.length,
      cost_usd: res.cost_usd,
      input_tokens: res.inputTokens,
      output_tokens: res.outputTokens,
    },
    'strategist: produced angles',
  );

  const out: StrategistOutput = {
    angles: v.data.angles,
    cost_usd: res.cost_usd,
  };
  // Final round-trip validation enforces the contract at the boundary.
  return StrategistOutputSchema.parse(out);
}

// ---------- helpers ----------
function enforcePillarConsistency(angles: StrategistAngle[], brand: Brand): void {
  const expected: Record<BrandDay, string> = {
    mon: brand.cadence.mon.pillar,
    wed: brand.cadence.wed.pillar,
    fri: brand.cadence.fri.pillar,
  };
  const violations: string[] = [];
  for (const a of angles) {
    const want = expected[a.day];
    if (a.pillar !== want) {
      violations.push(`day=${a.day}: expected pillar="${want}", got pillar="${a.pillar}"`);
    }
  }
  if (violations.length > 0) {
    throw new StrategistSchemaError(
      `strategist: pillar mismatch vs brand.cadence: ${violations.join('; ')}`,
    );
  }
}

function enforceDayCoverage(angles: StrategistAngle[]): void {
  const days = new Set(angles.map((a) => a.day));
  for (const d of DAY_VALUES) {
    if (!days.has(d)) {
      throw new StrategistSchemaError(
        `strategist: missing angle for day="${d}". Got days=[${angles.map((a) => a.day).join(', ')}]`,
      );
    }
  }
  if (angles.length !== DAY_VALUES.length) {
    throw new StrategistSchemaError(
      `strategist: expected exactly ${DAY_VALUES.length} angles, got ${angles.length}`,
    );
  }
}
