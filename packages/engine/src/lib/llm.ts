import Anthropic from '@anthropic-ai/sdk';

export type Model = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

// USD per million tokens. `aliases` lets brand.yaml use short ids (e.g.
// `claude-haiku-4-5`) while pricing/SDK calls use the canonical key.
const PRICING: Record<Model, { input: number; output: number; aliases: string[] }> = {
  'claude-sonnet-4-6': { input: 3, output: 15, aliases: [] },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, aliases: ['claude-haiku-4-5'] },
};

export interface CompleteParams {
  client: Anthropic;
  model: Model;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost_usd: number;
}

// Per-call ceiling and retry budget for every Anthropic request. Centralized
// here so the timeout applies to every node, not just one. 120s covers a slow
// completion without letting a hung call stall a whole run; maxRetries handles
// transient 429/5xx with the SDK's built-in backoff.
const CLIENT_TIMEOUT_MS = 120_000;
const CLIENT_MAX_RETRIES = 2;

export function makeClient(apiKey = process.env.ANTHROPIC_API_KEY): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: CLIENT_MAX_RETRIES });
}

export function estimateCostUsd(p: { inputTokens: number; outputTokens: number; model: Model }): number {
  const prices = PRICING[p.model];
  return (p.inputTokens / 1_000_000) * prices.input + (p.outputTokens / 1_000_000) * prices.output;
}

export async function complete(p: CompleteParams): Promise<CompleteResult> {
  const res = await p.client.messages.create({
    model: p.model as any,
    max_tokens: p.maxTokens ?? 1024,
    temperature: p.temperature ?? 0.7,
    system: p.system,
    messages: [{ role: 'user', content: p.user }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const inputTokens = res.usage?.input_tokens ?? 0;
  const outputTokens = res.usage?.output_tokens ?? 0;
  return { text, inputTokens, outputTokens, cost_usd: estimateCostUsd({ inputTokens, outputTokens, model: p.model }) };
}

export async function completeJson<T>(
  p: CompleteParams & { schema: { safeParse: (x: unknown) => { success: true; data: T } | { success: false } } },
): Promise<{ data: T; cost_usd: number }> {
  const res = await complete({
    ...p,
    system: p.system + '\n\nRespond with valid JSON only. No prose, no code fences.',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${res.text.slice(0, 200)}`);
  }
  const v = p.schema.safeParse(parsed);
  if (!v.success) throw new Error('LLM JSON failed schema validation');
  return { data: v.data, cost_usd: res.cost_usd };
}

/**
 * Best-effort JSON extractor for LLM responses. Strips code fences and, if
 * direct parse fails, falls back to slicing the first `{` through the last `}`
 * in case the model added prose around the object.
 *
 * @returns Parsed value, or `null` if no JSON could be extracted.
 */
export function extractJson(text: string): unknown | null {
  const cleaned = text.trim().replace(/^```json\s*|\s*```$/g, '').replace(/^```\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to brace extraction.
  }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Map a brand-config model id or alias to the canonical pricing key.
 * Looks up exact key first, then scans `aliases` on each PRICING entry.
 * Throws if neither matches — keeps the PRICING table as the single source
 * of truth for both supported models and their accepted aliases.
 */
export function resolveModelId(modelOrAlias: string): Model {
  if (Object.prototype.hasOwnProperty.call(PRICING, modelOrAlias)) {
    return modelOrAlias as Model;
  }
  for (const [id, info] of Object.entries(PRICING)) {
    if (info.aliases.includes(modelOrAlias)) return id as Model;
  }
  throw new Error(`unknown model id or alias: ${modelOrAlias}`);
}
