import { z } from 'zod';

export const PillarEnum = z.enum(['framework', 'hottake', 'story', 'lesson', 'myth', 'observation', 'list']);
export type Pillar = z.infer<typeof PillarEnum>;

export const DayEnum = z.enum(['mon', 'wed', 'fri']);
export type Day = z.infer<typeof DayEnum>;

export const SourceKindEnum = z.enum(['lab_blog', 'curated_newsletter', 'hn', 'voice_handle']);
export type SourceKind = z.infer<typeof SourceKindEnum>;

// ---------- stage 1: scrape ----------
export const RawItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  body: z.string(),
  author: z.string().optional(),
  published_at: z.string().datetime(),
  source: z.string().min(1),         // source key, e.g. "anthropic-blog"
  source_kind: SourceKindEnum.optional(),
});
export type RawItem = z.infer<typeof RawItemSchema>;

// ---------- stage 2: cluster ----------
export const ClusterSchema = z.object({
  topic: z.string().min(1),
  items: z.array(RawItemSchema).min(1),
  earliest_date: z.string().datetime(),
  source_count: z.number().int().positive(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

// ---------- stage 3: score ----------
export const ScoredClusterSchema = ClusterSchema.extend({
  novelty: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  confirmation: z.number().min(0).max(1),
  controversy: z.number().min(0).max(1),
  final_score: z.number().min(0).max(1),
});
export type ScoredCluster = z.infer<typeof ScoredClusterSchema>;

// ---------- stage 4: angle ----------
export const AngleSchema = z.object({
  day: DayEnum,
  pillar: PillarEnum,
  cluster_topic: z.string(),
  cluster_urls: z.array(z.string().url()).min(1),
  one_line_angle: z.string().min(1),
  why_this_pillar: z.string().min(1),
});
export type Angle = z.infer<typeof AngleSchema>;

// ---------- stage 5: draft ----------
export const ClaimTypeEnum = z.enum(['stat', 'quote', 'attribution', 'capability', 'date', 'opinion']);
export const ClaimSchema = z.object({
  claim_text: z.string().min(1),
  type: ClaimTypeEnum,
  source_url: z.preprocess((v) => v ?? undefined, z.string().url().optional()),
  confidence: z.number().min(0).max(1),
}).refine(
  (c) => c.type === 'opinion' || c.source_url !== undefined,
  { message: 'non-opinion claims require source_url' },
);
export type Claim = z.infer<typeof ClaimSchema>;

export const DraftSchema = z.object({
  post_text: z.string().min(1),
  claims: z.array(ClaimSchema),
  pillar: PillarEnum,
  angle_rationale: z.string(),
  attempt: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
});
export type Draft = z.infer<typeof DraftSchema>;

// ---------- stage 6: polish ----------
export const VerdictEnum = z.enum(['PASS', 'FAIL', 'SOFT_FAIL']);
export const ClaimVerdictSchema = z.object({
  claim: ClaimSchema,
  verdict: VerdictEnum,
  reason: z.string(),
  matched_excerpt: z.string().optional(),
});
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

export const PolishedSchema = z.object({
  draft: DraftSchema,
  verdicts: z.array(ClaimVerdictSchema),
  voice_gate_pass: z.boolean(),
  voice_gate_failures: z.array(z.string()),
  hallucination_gate_pass: z.boolean(),
  final_markdown: z.string().optional(),
  skipped: z.boolean(),
  skipped_reason: z.string().optional(),
});
export type Polished = z.infer<typeof PolishedSchema>;

// ---------- run summary ----------
export const StageStatsSchema = z.object({
  stage: z.string(),
  duration_ms: z.number(),
  llm_calls: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type StageStats = z.infer<typeof StageStatsSchema>;

export const RunSummarySchema = z.object({
  week: z.string(),                  // e.g. "2026-W17"
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().optional(),
  stages: z.array(StageStatsSchema),
  total_cost_usd: z.number().nonnegative(),
  drafts_produced: z.number().int().nonnegative(),
  drafts_skipped: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;
