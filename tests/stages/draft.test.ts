import { describe, it, expect, vi } from 'vitest';
import { buildDraftPrompt, runDraftOnce } from '../../src/stages/draft.js';
import type { Angle } from '../../src/lib/schema.js';

const angle: Angle = {
  day: 'fri',
  pillar: 'hottake',
  cluster_topic: 'claude 4.7',
  cluster_urls: ['https://anthropic.com/news/claude-4-7'],
  one_line_angle: 'release cadence is the moat',
  why_this_pillar: 'cadence > raw capability',
};

describe('draft', () => {
  it('buildDraftPrompt includes pillar template + voice samples + sources', () => {
    const out = buildDraftPrompt({
      angle,
      pillarTemplate: 'PILLAR: hottake (template body)',
      sources: [{ url: 'https://anthropic.com/news/claude-4-7', body: 'Claude 4.7 release notes' }],
      voiceSamples: ['sample post 1', 'sample post 2'],
    });
    expect(out).toContain('PILLAR: hottake');
    expect(out).toContain('Claude 4.7 release notes');
    expect(out).toContain('sample post 1');
    expect(out).toContain('https://anthropic.com/news/claude-4-7');
  });

  it('runDraftOnce parses LLM JSON response into Draft', async () => {
    const fakeClient = { messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        post_text: 'A hook line of about ten words goes here today\nbody body body body body body body body body body body\nWhat do you think?',
        claims: [{ claim_text: 'release cadence', type: 'opinion', confidence: 0.6 }],
        pillar: 'hottake',
        angle_rationale: 'cadence > capability',
      }) }],
      usage: { input_tokens: 100, output_tokens: 80 },
    }) } } as any;
    const draft = await runDraftOnce({
      client: fakeClient,
      systemPrompt: 'sys',
      userPrompt: 'u',
    });
    expect(draft.post_text).toContain('hook line');
    expect(draft.pillar).toBe('hottake');
    expect(draft.cost_usd).toBeGreaterThan(0);
  });
});
