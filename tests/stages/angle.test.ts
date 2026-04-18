// tests/stages/angle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { dedupeVsRecent, runAngleStage } from '../../src/stages/angle.js';
import type { ScoredCluster } from '../../src/lib/schema.js';

vi.mock('../../src/lib/embed.js', () => ({
  embedTexts: vi.fn(async (xs: string[]) => xs.map((x) => x.includes('claude') ? [1, 0] : [0, 1])),
  cosine: (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!,
}));

const mkScored = (topic: string): ScoredCluster => ({
  topic,
  items: [{ url: 'https://x/1', title: topic, body: '', published_at: '2026-04-14T00:00:00Z', source: 's' }],
  earliest_date: '2026-04-14T00:00:00Z',
  source_count: 1,
  novelty: 1, authority: 1, confirmation: 1, controversy: 0, final_score: 0.8,
});

describe('angle', () => {
  it('dedupeVsRecent removes overlapping topics', async () => {
    const out = await dedupeVsRecent([mkScored('claude release'), mkScored('gpt-5')], ['claude analysis'], 0.85);
    expect(out.length).toBe(1);
    expect(out[0]!.topic).toBe('gpt-5');
  });
});
