import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Brand } from '../lib/brand.js';
import { BrandDayEnum } from '../lib/brand.js';
import { complete, extractJson, resolveModelId } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';

const log = makeLogger({ name: 'critic' });

// ---------- output schemas ----------
export const CriticVerdictEnum = z.enum(['approve', 'fix']);
export type CriticVerdictLabel = z.infer<typeof CriticVerdictEnum>;

export const CriticSeverityEnum = z.enum(['block', 'soft']);
export type CriticSeverity = z.infer<typeof CriticSeverityEnum>;

export const CriticVerdictSchema = z.object({
  day: BrandDayEnum,
  verdict: CriticVerdictEnum,
  /** block = hard fail, surgery required; soft = optional nit the orchestrator may ignore. */
  severity: CriticSeverityEnum,
  reasons: z.array(z.string().min(1)),
  /** Optional concrete edits for the retry loop. Defaults to []. */
  specific_fixes: z.array(z.string().min(1)).default([]),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export const CriticOutputSchema = z.object({
  verdicts: z.array(CriticVerdictSchema).length(3),
  cost_usd: z.number().nonnegative(),
});
export type CriticOutput = z.infer<typeof CriticOutputSchema>;

// LLM-returned shape per draft. `day` and `cost_usd` are server-side fields.
const LlmCriticPayloadSchema = z.object({
  verdict: CriticVerdictEnum,
  severity: CriticSeverityEnum,
  reasons: z.array(z.string().min(1)),
  specific_fixes: z.array(z.string().min(1)).optional().default([]),
});

// ---------- error ----------
/**
 * Thrown when the LLM returns a payload we cannot validate against the critic
 * schema. A malformed payload is a contract violation; callers decide whether
 * to retry, but we surface loudly rather than guessing a verdict.
 */
export class CriticSchemaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CriticSchemaError';
  }
}

// ---------- input types ----------
export interface CriticDraftInput {
  post_text: string;
  pillar: string;
}

export interface BuildCriticPromptParams {
  brand: Brand;
  draft: CriticDraftInput;
  day: 'mon' | 'wed' | 'fri';
}

export interface RunCriticOnceParams {
  client: Anthropic;
  brand: Brand;
  draft: CriticDraftInput;
  day: 'mon' | 'wed' | 'fri';
}

export interface RunCriticParams {
  client: Anthropic;
  brand: Brand;
  /** Exactly 3 drafts, one per day (mon/wed/fri). */
  drafts: Array<{ day: 'mon' | 'wed' | 'fri'; draft: CriticDraftInput }>;
}

// ---------- prompt assembly ----------
export function buildCriticPrompt(p: BuildCriticPromptParams): {
  system: string;
  user: string;
} {
  const system = buildSystemPrompt(p.brand);
  const user = buildUserPrompt(p);
  return { system, user };
}

function buildSystemPrompt(brand: Brand): string {
  const audience = brand.identity.audience.primary;
  const positioning = brand.identity.positioning;
  const hookPatterns = brand.engagement.hook_patterns
    .map((pat, i) => `  ${i + 1}. ${pat}`)
    .join('\n');
  const hookMaxWords = brand.voice.rhythm.hook_max_words;
  const requireSaveWorthy = brand.engagement.require_save_worthy;

  return [
    'You are a Senior Product Manager at a frontier AI lab (OpenAI / Anthropic / Google DeepMind).',
    'You read LinkedIn posts from people hoping to be hired onto your team.',
    '',
    'Your job is to critique a draft post harshly but fairly.',
    "A 'fix' verdict means the post would get scrolled past or damage the author's credibility with your network.",
    "An 'approve' verdict means you would read past line 1 and consider the author as serious PM signal.",
    '',
    `TARGET READER: ${audience}`,
    `AUTHOR POSITIONING (what they are trying to be): ${positioning}`,
    '',
    'CHECKLIST — evaluate the draft against each of these, in order:',
    '  1. PM signal — does the post demonstrate product judgment, tradeoffs, or shipping discipline?',
    '     Or is it generic tech-commentary with no PM point of view?',
    '  2. Audience-coded — would a frontier-lab PM read past line 1?',
    '     Does it use PM vocabulary (tradeoffs, metrics, shipped, 0→1) without being buzzwordy?',
    `  3. Hook strength — is line 1 a contradiction, specific number, or strong claim (≤${hookMaxWords} words)?`,
    '     Or is it generic? Valid hook patterns:',
    hookPatterns,
    `  4. Save-worthy artifact — require_save_worthy=${requireSaveWorthy}.`,
    '     Is there a framework name, checklist, numbered list, table, or named pattern worth saving?',
    '  5. Engagement pattern match — does the post structure match one of the hook patterns above?',
    '',
    'SEVERITY RULES:',
    "  - block = fundamentally wrong. Generic, no PM signal, bad hook, or no save-worthy artifact when required.",
    "  - soft  = minor nit. One phrase clunky, closing could be tighter, weak transition.",
    '',
    "If you verdict='approve', severity may still be 'soft' for nits; specific_fixes can be empty.",
    "If you verdict='fix', reasons must be specific (not 'improve the hook' — say WHY).",
    '',
    'Output ONE JSON object with this exact shape:',
    '{',
    '  "verdict": "approve" | "fix",',
    '  "severity": "block" | "soft",',
    '  "reasons": ["why — short specific sentences"],',
    '  "specific_fixes": ["concrete edit for retry"]',
    '}',
    '',
    'Output ONLY JSON. No preamble.',
  ].join('\n');
}

function buildUserPrompt(p: BuildCriticPromptParams): string {
  return `DAY: ${p.day}
PILLAR: ${p.draft.pillar}
DRAFT:
${p.draft.post_text}

Critique now. JSON only.`;
}

// ---------- single-draft critique ----------
export async function runCriticOnce(
  p: RunCriticOnceParams,
): Promise<{ verdict: CriticVerdict; cost_usd: number }> {
  const cfg = p.brand.agents.critic;
  const { system, user } = buildCriticPrompt({
    brand: p.brand,
    draft: p.draft,
    day: p.day,
  });

  const res = await complete({
    client: p.client,
    model: resolveModelId(cfg.model),
    system,
    user,
    maxTokens: cfg.max_tokens,
    temperature: 0.3,
  });

  const parsed = extractJson(res.text);
  if (parsed === null) {
    throw new CriticSchemaError(
      `critic: LLM returned no parseable JSON (day=${p.day}). Raw text (first 800 chars):\n${res.text.slice(0, 800)}`,
    );
  }

  const v = LlmCriticPayloadSchema.safeParse(parsed);
  if (!v.success) {
    const payload = JSON.stringify(parsed).slice(0, 800);
    throw new CriticSchemaError(
      `critic: LLM JSON failed schema validation (day=${p.day}): ${JSON.stringify(v.error.issues)}\npayload: ${payload}`,
    );
  }

  // Graft `day` from params; LLM judges on merit and does not echo day.
  const verdict = CriticVerdictSchema.parse({
    day: p.day,
    verdict: v.data.verdict,
    severity: v.data.severity,
    reasons: v.data.reasons,
    specific_fixes: v.data.specific_fixes,
  });

  return { verdict, cost_usd: res.cost_usd };
}

// ---------- parallel fan-out ----------
export async function runCritic(p: RunCriticParams): Promise<CriticOutput> {
  validateDrafts(p.drafts);

  const results = await Promise.all(
    p.drafts.map(async (d) => {
      return runCriticOnce({
        client: p.client,
        brand: p.brand,
        draft: d.draft,
        day: d.day,
      });
    }),
  );

  const verdicts = results.map((r) => r.verdict);
  const cost_usd = results.reduce((sum, r) => sum + r.cost_usd, 0);

  log.info(
    {
      cost_usd,
      verdicts: verdicts.map((v) => ({
        day: v.day,
        verdict: v.verdict,
        severity: v.severity,
      })),
      parallel: true,
    },
    'critic: produced verdicts',
  );

  return CriticOutputSchema.parse({ verdicts, cost_usd });
}

// ---------- helpers ----------
const DAY_VALUES = ['mon', 'wed', 'fri'] as const;

function validateDrafts(
  drafts: Array<{ day: 'mon' | 'wed' | 'fri'; draft: CriticDraftInput }>,
): void {
  if (drafts.length !== DAY_VALUES.length) {
    throw new CriticSchemaError(
      `critic: expected 3 drafts, got ${drafts.length}`,
    );
  }
  const seen = new Set<string>();
  for (const d of drafts) {
    if (seen.has(d.day)) {
      throw new CriticSchemaError(
        `critic: duplicate day "${d.day}" in drafts`,
      );
    }
    seen.add(d.day);
  }
  for (const d of DAY_VALUES) {
    if (!seen.has(d)) {
      throw new CriticSchemaError(
        `critic: expected 3 drafts, missing day "${d}"`,
      );
    }
  }
}
