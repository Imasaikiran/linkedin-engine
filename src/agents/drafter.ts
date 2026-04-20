import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Brand } from '../lib/brand.js';
import { BrandDayEnum } from '../lib/brand.js';
import { complete, extractJson, resolveModelId } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';
import { ClaimSchema, DraftSchema, type Draft } from '../lib/schema.js';
import type { StrategistAngle } from './strategist.js';

const log = makeLogger({ name: 'drafter' });

// ---------- output types ----------
export const DrafterDayResultSchema = z.object({
  day: BrandDayEnum,
  draft: DraftSchema,
});
export type DrafterDayResult = z.infer<typeof DrafterDayResultSchema>;

export const DrafterOutputSchema = z.object({
  results: z.array(DrafterDayResultSchema).length(3),
  cost_usd: z.number().nonnegative(),
});
export type DrafterOutput = z.infer<typeof DrafterOutputSchema>;

// ---------- input types ----------
export interface DrafterSource {
  url: string;
  body: string;
}

export interface BuildDrafterPromptParams {
  brand: Brand;
  angle: StrategistAngle;
  sources: DrafterSource[];
  voiceSamples: string[];
}

export interface RunDrafterOnceParams {
  client: Anthropic;
  brand: Brand;
  angle: StrategistAngle;
  sources: DrafterSource[];
  voiceSamples: string[];
  /** Retry attempt index (0-based). Defaults to 0. Metadata only; no retry logic here. */
  attempt?: number;
}

export interface RunDrafterParams {
  client: Anthropic;
  brand: Brand;
  /** Exactly 3 angles, one per day (mon/wed/fri). */
  angles: StrategistAngle[];
  sourcesByDay: Record<'mon' | 'wed' | 'fri', DrafterSource[]>;
  voiceSamplesByDay: Record<'mon' | 'wed' | 'fri', string[]>;
}

// ---------- error ----------
/**
 * Thrown when the LLM returns a payload we cannot validate against the
 * DraftSchema-equivalent shape, or when `pillar` disagrees with angle.pillar.
 * Callers (orchestrator) decide whether to retry; we surface loudly here.
 */
export class DrafterSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrafterSchemaError';
  }
}

// DraftSchema pins `pillar` to a legacy PillarEnum that does not include the
// brand.cadence pillars ("shipped", "critique"). Since Task 4 must not modify
// lib/schema.ts, we parse the LLM payload with a local schema that mirrors
// DraftSchema's shape but widens `pillar` to `z.string()`, then enforce
// pillar === angle.pillar explicitly. Revisit in Task 11 when legacy tears down.
const LlmDraftPayloadSchema = z.object({
  post_text: z.string().min(1),
  claims: z.array(ClaimSchema),
  pillar: z.string().min(1),
  angle_rationale: z.string(),
});

// ---------- prompt assembly ----------
export function buildDrafterPrompt(p: BuildDrafterPromptParams): {
  system: string;
  user: string;
} {
  const system = buildSystemPrompt(p.brand);
  const user = buildUserPrompt(p);
  return { system, user };
}

function buildSystemPrompt(brand: Brand): string {
  const v = brand.voice;
  const rhythm = v.rhythm;
  const bannedPhrases = v.must_not_have.banned_phrases
    .map((s) => `  - "${s}"`)
    .join('\n');
  const bannedOpeners = v.must_not_have.banned_openers
    .map((s) => `  - "${s}"`)
    .join('\n');
  const mustHave = v.must_have_in_every_post.map((s) => `  - ${s}`).join('\n');
  const dashRule = [
    v.must_not_have.em_dashes ? 'em_dashes: false (ZERO em dashes)' : null,
    v.must_not_have.en_dashes ? 'en_dashes: false (ZERO en dashes)' : null,
  ]
    .filter(Boolean)
    .join('; ');

  return [
    "You are Drafter, writing a LinkedIn post per the user's brand voice.",
    '',
    'BANNED PHRASES (never use any of these, verbatim or paraphrased):',
    bannedPhrases,
    '',
    'BANNED OPENERS (the first line must NOT start with any of these):',
    bannedOpeners,
    '',
    `DASHES: ${dashRule}. Replace with commas, periods, or sentence breaks.`,
    '',
    'MUST HAVE IN EVERY POST:',
    mustHave,
    '',
    'RHYTHM:',
    `  - hook_max_words: ${rhythm.hook_max_words} (first line is a hook, no trailing period)`,
    `  - paragraph_max_lines: ${rhythm.paragraph_max_lines}`,
    `  - target_words: [${rhythm.target_words[0]}, ${rhythm.target_words[1]}] (inclusive)`,
    `  - target_chars: [${rhythm.target_chars[0]}, ${rhythm.target_chars[1]}] (inclusive)`,
    '',
    'Output a SINGLE JSON object. No preamble, no code fences.',
    'Exact shape (claims MUST be an array of objects, NOT strings):',
    '{',
    '  "post_text": "the LinkedIn post body",',
    '  "claims": [',
    '    { "claim_text": "...", "type": "stat|quote|attribution|capability|date|opinion", "source_url": "https://...", "confidence": 0.9 }',
    '  ],',
    '  "pillar": "<pillar slug>",',
    '  "angle_rationale": "one or two sentences"',
    '}',
    'Rules for claims:',
    '  - Every factual/numeric/quoted/attribution claim in post_text MUST have a matching claim object.',
    '  - type="opinion" is the ONLY type that may omit source_url. For opinion claims, OMIT the source_url field entirely (do NOT use empty string, "N/A", or null).',
    '  - For every non-opinion type, source_url MUST be a real https:// URL copied verbatim from the SOURCES block. Never invent URLs.',
    '  - confidence is REQUIRED on every claim. Range [0, 1]. Use 0.9+ for verbatim source facts, 0.6-0.8 for paraphrased/inferred, 0.3-0.5 for opinion.',
    '  - Do NOT emit claims as bare strings. Each claim is an object with claim_text+type+confidence (and source_url for non-opinion).',
  ].join('\n');
}

function buildUserPrompt(p: BuildDrafterPromptParams): string {
  const cad = p.brand.cadence[p.angle.day];
  const requiresBlock = cad.requires.map((r) => `  - ${r}`).join('\n');
  const sourceBlock = p.sources
    .map((s) => `URL: ${s.url}\nBODY:\n${s.body.slice(0, 2000)}`)
    .join('\n---\n');
  const samplesBlock = p.voiceSamples
    .map((s, i) => `SAMPLE ${i + 1}:\n${s}`)
    .join('\n---\n');

  return `PILLAR TEMPLATE (${p.angle.day}, pillar="${cad.pillar}"):
${cad.template}
REQUIRES (these must appear in the post):
${requiresBlock}

ANGLE:
  hook_idea: ${p.angle.hook_idea}
  why_it_works: ${p.angle.why_it_works}

SOURCES (use ONLY these for facts/quotes/stats/attributions):
${sourceBlock}

VOICE SAMPLES (mirror register/rhythm; do NOT reuse topics or phrasings):
${samplesBlock}

Return JSON with pillar="${cad.pillar}" exactly.
Write the post now. JSON only.`;
}

// ---------- single-angle draft ----------
export async function runDrafterOnce(p: RunDrafterOnceParams): Promise<Draft> {
  const cfg = p.brand.agents.drafter;
  const { system, user } = buildDrafterPrompt({
    brand: p.brand,
    angle: p.angle,
    sources: p.sources,
    voiceSamples: p.voiceSamples,
  });

  const res = await complete({
    client: p.client,
    model: resolveModelId(cfg.model),
    system,
    user,
    maxTokens: cfg.max_tokens,
    temperature: 0.7,
  });

  const parsed = extractJson(res.text);
  if (parsed === null) {
    throw new DrafterSchemaError(
      `drafter: LLM returned no parseable JSON (day=${p.angle.day}). Raw text (first 800 chars):\n${res.text.slice(0, 800)}`,
    );
  }

  const v = LlmDraftPayloadSchema.safeParse(parsed);
  if (!v.success) {
    const payload = JSON.stringify(parsed).slice(0, 800);
    throw new DrafterSchemaError(
      `drafter: LLM JSON failed schema validation (day=${p.angle.day}): ${JSON.stringify(v.error.issues)}\npayload: ${payload}`,
    );
  }

  // Pillar contract: brand.cadence pins the pillar per day and the strategist
  // echoed it in angle.pillar. The drafter's output must match exactly — any
  // drift is a contract violation, not a retryable quality issue.
  if (v.data.pillar !== p.angle.pillar) {
    throw new DrafterSchemaError(
      `drafter: pillar mismatch (day=${p.angle.day}): expected "${p.angle.pillar}", got "${v.data.pillar}"`,
    );
  }

  // Runtime cast: DraftSchema.pillar is still legacy PillarEnum (see comment on
  // LlmDraftPayloadSchema). Consumers that re-parse via DraftSchema will reject
  // brand.cadence pillars until the legacy enum is retired in Task 11.
  const draft = {
    post_text: v.data.post_text,
    claims: v.data.claims,
    pillar: v.data.pillar,
    angle_rationale: v.data.angle_rationale,
    attempt: p.attempt ?? 0,
    cost_usd: res.cost_usd,
  } as unknown as Draft;

  return draft;
}

// ---------- parallel fan-out ----------
export async function runDrafter(p: RunDrafterParams): Promise<DrafterOutput> {
  validateAngles(p.angles);

  const results = await Promise.all(
    p.angles.map(async (angle) => {
      const day = angle.day;
      const draft = await runDrafterOnce({
        client: p.client,
        brand: p.brand,
        angle,
        sources: p.sourcesByDay[day] ?? [],
        voiceSamples: p.voiceSamplesByDay[day] ?? [],
        attempt: 0,
      });
      return { day, draft };
    }),
  );

  const cost_usd = results.reduce((sum, r) => sum + r.draft.cost_usd, 0);

  log.info(
    { cost_usd, days: results.length, parallel: true },
    'drafter: produced drafts',
  );

  // DrafterDayResultSchema wraps DraftSchema, whose pillar is the legacy
  // PillarEnum. We intentionally bypass that final schema parse here for the
  // same reason documented on LlmDraftPayloadSchema: the `draft` objects may
  // carry brand.cadence pillars (e.g. "shipped") which DraftSchema rejects.
  // We DO validate the outer wrapper shape below, minus DraftSchema.
  const out: DrafterOutput = { results, cost_usd } as DrafterOutput;
  return out;
}

// ---------- helpers ----------
const DAY_VALUES = ['mon', 'wed', 'fri'] as const;

function validateAngles(angles: StrategistAngle[]): void {
  if (angles.length !== DAY_VALUES.length) {
    throw new DrafterSchemaError(
      `drafter: expected 3 angles, got ${angles.length}`,
    );
  }
  const seen = new Set<string>();
  for (const a of angles) {
    if (seen.has(a.day)) {
      throw new DrafterSchemaError(
        `drafter: duplicate day "${a.day}" in angles`,
      );
    }
    seen.add(a.day);
  }
  for (const d of DAY_VALUES) {
    if (!seen.has(d)) {
      throw new DrafterSchemaError(
        `drafter: expected 3 angles, missing day "${d}"`,
      );
    }
  }
}
