import { describe, it, expect, vi } from 'vitest';
import { complete, estimateCostUsd } from '../../src/lib/llm.js';

describe('llm', () => {
  it('estimateCostUsd computes Sonnet pricing', () => {
    // Sonnet 4.6: $3/MTok input, $15/MTok output
    const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-4-6' });
    expect(cost).toBeCloseTo(18, 2);
  });

  it('complete calls SDK with correct shape', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const fakeClient = { messages: { create } } as any;
    const out = await complete({
      client: fakeClient,
      model: 'claude-sonnet-4-6',
      system: 'sys',
      user: 'u',
      maxTokens: 100,
    });
    expect(out.text).toBe('hi');
    expect(out.cost_usd).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'u' }],
    }));
  });
});
