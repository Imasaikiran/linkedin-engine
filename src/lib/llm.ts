import Anthropic from '@anthropic-ai/sdk';

export type Model = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

const PRICING: Record<Model, { input: number; output: number }> = {
  // USD per million tokens
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
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

export function makeClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
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
