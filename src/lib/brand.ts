import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ---------- voice ----------
export const VoiceMustHaveEnum = z.enum([
  'first_person_past_tense',
  'one_concrete_number',
  'one_named_product_or_person',
]);
export type VoiceMustHave = z.infer<typeof VoiceMustHaveEnum>;

export const WhiteSpaceEnum = z.enum(['aggressive', 'moderate', 'minimal']);
export type WhiteSpace = z.infer<typeof WhiteSpaceEnum>;

export const FallbackOnOverrunEnum = z.enum(['skip_with_summary', 'use_legacy_pipeline']);
export type FallbackOnOverrun = z.infer<typeof FallbackOnOverrunEnum>;

export const BrandDayEnum = z.enum(['mon', 'wed', 'fri']);
export type BrandDay = z.infer<typeof BrandDayEnum>;

// ---------- identity ----------
export const IdentitySchema = z.object({
  role: z.string().min(1),
  goal: z.string().min(1),
  audience: z.object({
    primary: z.string().min(1),
    secondary: z.string().min(1),
  }),
  positioning: z.string().min(1),
});

// ---------- voice ----------
export const VoiceSchema = z.object({
  must_have_in_every_post: z.array(VoiceMustHaveEnum),
  must_not_have: z.object({
    em_dashes: z.boolean(),
    en_dashes: z.boolean(),
    banned_phrases: z.array(z.string()),
    banned_openers: z.array(z.string()),
  }),
  rhythm: z.object({
    hook_max_words: z.number().int().positive(),
    paragraph_max_lines: z.number().int().positive(),
    target_words: z.tuple([z.number(), z.number()]),
    target_chars: z.tuple([z.number(), z.number()]),
  }),
});

// ---------- cadence ----------
export const CadenceDaySchema = z.object({
  pillar: z.string().min(1),
  template: z.string().min(1),
  requires: z.array(z.string().min(1)),
});

export const CadenceSchema = z.object({
  mon: CadenceDaySchema,
  wed: CadenceDaySchema,
  fri: CadenceDaySchema,
});

// ---------- engagement ----------
export const EngagementSchema = z.object({
  hook_patterns: z.array(z.string().min(1)),
  require_save_worthy: z.boolean(),
  closing_question_optional: z.boolean(),
  white_space: WhiteSpaceEnum,
});

// ---------- sources ----------
export const SourcesSchema = z.object({
  rss_config: z.string().min(1),
  web_search: z.object({
    enabled: z.boolean(),
    queries_per_run: z.number().int().positive(),
    queries: z.array(z.string().min(1)),
  }),
  voice_corpus: z.object({
    dir: z.string().min(1),
    samples_per_draft: z.number().int().positive(),
  }),
});

// ---------- agents ----------
export const AgentConfigSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  parallel: z.boolean().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentsSchema = z.object({
  scout: AgentConfigSchema,
  strategist: AgentConfigSchema,
  drafter: AgentConfigSchema,
  critic: AgentConfigSchema,
  max_retry_loops: z.number().int().nonnegative(),
});

// ---------- budgets ----------
export const BudgetsSchema = z.object({
  cost_usd_per_run: z.number().positive(),
  wall_time_seconds: z.number().int().positive(),
  fallback_on_overrun: FallbackOnOverrunEnum,
});

// ---------- quality ----------
export const QualitySchema = z.object({
  publish_only_if_critic_approves: z.boolean(),
  publish_if_voice_gate_passes_even_if_critic_soft_rejects: z.boolean(),
  fail_open: z.boolean(),
});

// ---------- root ----------
export const BrandSchema = z.object({
  identity: IdentitySchema,
  voice: VoiceSchema,
  cadence: CadenceSchema,
  engagement: EngagementSchema,
  sources: SourcesSchema,
  agents: AgentsSchema,
  budgets: BudgetsSchema,
  quality: QualitySchema,
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * Load and validate the brand.yaml config.
 *
 * @param filePath Optional explicit path. Defaults to `<cwd>/brand.yaml`.
 * @returns The parsed and validated `Brand` config.
 * @throws Error with zod issues + truncated payload if validation fails.
 */
export function loadBrand(filePath?: string): Brand {
  const resolved = filePath ?? path.join(process.cwd(), 'brand.yaml');
  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read brand.yaml at ${resolved}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse brand.yaml at ${resolved}: ${msg}`);
  }

  const result = BrandSchema.safeParse(parsed);
  if (!result.success) {
    const issues = JSON.stringify(result.error.issues, null, 2);
    const payload = JSON.stringify(parsed, null, 2);
    const truncated = payload.length > 1000 ? `${payload.slice(0, 1000)}\n... [truncated]` : payload;
    throw new Error(
      `brand.yaml validation failed at ${resolved}:\nissues: ${issues}\npayload: ${truncated}`,
    );
  }

  return result.data;
}
