import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Brand } from '../lib/brand.js';
import { estimateCostUsd, extractJson, resolvePricingModel } from '../lib/llm.js';
import { parseRss } from '../lib/rss.js';

// ---------- output schema ----------
export const TopicItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().min(1),
  published_at: z.string().datetime().optional(),
});
export type TopicItem = z.infer<typeof TopicItemSchema>;

export const ScoutSourceEnum = z.enum(['web_search', 'rss_fallback']);
export type ScoutSource = z.infer<typeof ScoutSourceEnum>;

export const ScoutOutputSchema = z.object({
  trending_topics: z.array(TopicItemSchema).max(10),
  recent_launches: z.array(TopicItemSchema).max(10),
  engagement_signals: z.array(z.string().min(1)).max(10).default([]),
  cost_usd: z.number().nonnegative(),
  source: ScoutSourceEnum,
});
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;

// LLM-returned shape (no cost / source — those are server-side).
const LlmScoutPayloadSchema = z.object({
  trending_topics: z.array(TopicItemSchema).max(10),
  recent_launches: z.array(TopicItemSchema).max(10),
  engagement_signals: z.array(z.string().min(1)).max(10).optional().default([]),
});

// ---------- prompts ----------
const SYSTEM_PROMPT = [
  'You are Trend Scout, an intelligence agent for an AI-PM content engine.',
  'Use the provided web_search tool to research what frontier-lab AI Product Managers',
  'are talking about and what AI products launched recently. Aggregate findings into',
  'a single JSON object with the exact shape requested by the user.',
  '',
  'IMPORTANT: Output ONLY a single JSON object. No preamble, no commentary, no code fences.',
].join('\n');

export function buildScoutUserPrompt(p: {
  queries: string[];
  queriesPerRun: number;
  todayYearMonth: string;
}): string {
  const substituted = p.queries.map((q) => q.replace(/\{today_year_month\}/g, p.todayYearMonth));
  const queryBlock = substituted.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Today's year-month: ${p.todayYearMonth}.

Run up to ${p.queriesPerRun} web_search calls. Use these query strings (substitute dates as already done):
${queryBlock}

After searching, aggregate the results into the following JSON object:

{
  "trending_topics": [ // up to 10, what AI PMs are actively discussing this week
    { "title": "...", "url": "https://...", "summary": "1-2 sentences", "published_at": "ISO 8601 if known" }
  ],
  "recent_launches": [ // up to 10, AI product launches / releases this week
    { "title": "...", "url": "https://...", "summary": "1-2 sentences", "published_at": "ISO 8601 if known" }
  ],
  "engagement_signals": [ // up to 10 short observations about what is driving engagement
    "Posts comparing Claude vs GPT routing get 3x engagement",
    "Threads about agent eval frameworks are spiking"
  ]
}

Hard rules:
- Output JSON only. No prose. No code fences.
- url must be a real URL or omitted entirely (do not invent).
- summary must be concrete (mention named products, companies, or PMs).
- engagement_signals are short observations, not URLs.
`;
}

// ---------- main entry point ----------
export interface RunScoutParams {
  client: Anthropic;
  brand: Brand;
  /** Optional clock for deterministic tests. Defaults to `new Date()`. */
  today?: Date;
  /** Optional sources.yaml path override (defaults to `brand.sources.rss_config`). */
  rssConfigPath?: string;
}

/**
 * Thrown when the LLM returns a payload we cannot validate against
 * `ScoutOutputSchema`. These are NOT swallowed by the RSS fallback —
 * a malformed payload is a contract violation that should surface loudly.
 */
export class ScoutSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoutSchemaError';
  }
}

export async function runScout(p: RunScoutParams): Promise<ScoutOutput> {
  const today = p.today ?? new Date();
  const todayYearMonth = formatYearMonth(today);

  const webSearchEnabled = p.brand.sources.web_search.enabled;

  if (webSearchEnabled) {
    try {
      return await runScoutViaWebSearch({ ...p, today, todayYearMonth });
    } catch (err) {
      // Schema/parse errors are contract violations — rethrow.
      if (err instanceof ScoutSchemaError) throw err;
      // Otherwise (transport / SDK / network) fall back to RSS, but surface a
      // warning so the failure stays visible during runs.
      // eslint-disable-next-line no-console
      console.warn(
        `scout: web_search failed (${err instanceof Error ? err.message : String(err)}); falling back to RSS`,
      );
    }
  }

  return runScoutViaRss({ brand: p.brand, rssConfigPath: p.rssConfigPath });
}

// ---------- primary path: web_search ----------
async function runScoutViaWebSearch(p: {
  client: Anthropic;
  brand: Brand;
  today: Date;
  todayYearMonth: string;
}): Promise<ScoutOutput> {
  const scoutCfg = p.brand.agents.scout;
  const ws = p.brand.sources.web_search;
  const userPrompt = buildScoutUserPrompt({
    queries: ws.queries,
    queriesPerRun: ws.queries_per_run,
    todayYearMonth: p.todayYearMonth,
  });

  const res = await p.client.messages.create({
    model: scoutCfg.model as any,
    max_tokens: scoutCfg.max_tokens,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: ws.queries_per_run,
      } as any,
    ],
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = (res.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = extractJson(text);
  if (parsed === null) {
    throw new ScoutSchemaError(
      `scout: LLM returned no parseable JSON. Raw text (first 800 chars):\n${text.slice(0, 800)}`,
    );
  }

  const v = LlmScoutPayloadSchema.safeParse(parsed);
  if (!v.success) {
    const payload = JSON.stringify(parsed).slice(0, 800);
    throw new ScoutSchemaError(
      `scout: LLM JSON failed schema validation: ${JSON.stringify(v.error.issues)}\npayload: ${payload}`,
    );
  }

  const inputTokens = res.usage?.input_tokens ?? 0;
  const outputTokens = res.usage?.output_tokens ?? 0;
  const cost_usd = estimateCostUsd({
    inputTokens,
    outputTokens,
    model: resolvePricingModel(scoutCfg.model),
  });

  const result: ScoutOutput = {
    trending_topics: v.data.trending_topics,
    recent_launches: v.data.recent_launches,
    engagement_signals: v.data.engagement_signals ?? [],
    cost_usd,
    source: 'web_search',
  };
  // Final round-trip validation so the contract is enforced at the boundary.
  return ScoutOutputSchema.parse(result);
}

// ---------- fallback path: RSS ----------
const SourcesYamlSchema = z.object({
  lab_blogs: z.array(z.object({ name: z.string(), rss: z.string().url() })).default([]),
  curated_newsletters: z.array(z.object({ name: z.string(), rss: z.string().url() })).default([]),
});

async function runScoutViaRss(p: {
  brand: Brand;
  rssConfigPath?: string;
}): Promise<ScoutOutput> {
  const cfgPath = p.rssConfigPath
    ?? path.join(process.cwd(), p.brand.sources.rss_config);
  const raw = readFileSync(cfgPath, 'utf8');
  const parsedYaml = SourcesYamlSchema.parse(parseYaml(raw));
  const feeds = [
    ...parsedYaml.lab_blogs.map((f) => ({ name: f.name, rss: f.rss })),
    ...parsedYaml.curated_newsletters.map((f) => ({ name: f.name, rss: f.rss })),
  ];

  const collected: TopicItem[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.rss);
      if (!res.ok) continue;
      const xml = await res.text();
      const items = await parseRss(xml, feed.name);
      for (const it of items) {
        collected.push({
          title: it.title,
          url: it.url,
          summary: it.body.slice(0, 280),
          published_at: it.published_at,
        });
      }
    } catch {
      // Skip individual feed errors; aggregate what we can.
      continue;
    }
  }

  // Sort newest first.
  collected.sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });

  const trending = collected.slice(0, 10);
  const launches = collected.slice(10, 20);

  const result: ScoutOutput = {
    trending_topics: trending,
    recent_launches: launches,
    engagement_signals: [],
    cost_usd: 0,
    source: 'rss_fallback',
  };
  return ScoutOutputSchema.parse(result);
}

// ---------- helpers ----------
function formatYearMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
