import { describe, it, expect } from 'vitest';
import { RawItemSchema, ClusterSchema, ScoredClusterSchema, AngleSchema, DraftSchema, ClaimSchema } from '../../src/lib/schema.js';

describe('schema', () => {
  it('RawItemSchema accepts valid item', () => {
    const ok = RawItemSchema.safeParse({
      url: 'https://anthropic.com/news/x',
      title: 'X',
      body: 'body text',
      author: 'A',
      published_at: '2026-04-15T00:00:00Z',
      source: 'anthropic-blog',
    });
    expect(ok.success).toBe(true);
  });

  it('RawItemSchema rejects bad url', () => {
    const bad = RawItemSchema.safeParse({ url: 'not-a-url', title: 'x', body: 'y', published_at: '2026-04-15T00:00:00Z', source: 's' });
    expect(bad.success).toBe(false);
  });

  it('ClaimSchema requires source_url unless type=opinion', () => {
    const opinionOk = ClaimSchema.safeParse({ claim_text: 'x', type: 'opinion', confidence: 0.5 });
    expect(opinionOk.success).toBe(true);
    const statBad = ClaimSchema.safeParse({ claim_text: '70%', type: 'stat', confidence: 0.9 });
    expect(statBad.success).toBe(false);
    const statOk = ClaimSchema.safeParse({ claim_text: '70%', type: 'stat', source_url: 'https://x.com/y', confidence: 0.9 });
    expect(statOk.success).toBe(true);
  });

  it('DraftSchema requires post_text + claims array', () => {
    const ok = DraftSchema.safeParse({
      post_text: 'hello',
      claims: [],
      pillar: 'hottake',
      angle_rationale: 'r',
    });
    expect(ok.success).toBe(true);
  });

  it('ScoredClusterSchema final score in [0,1]', () => {
    const bad = ScoredClusterSchema.safeParse({ topic: 't', items: [], earliest_date: '2026-04-15T00:00:00Z', source_count: 1, final_score: 1.5 });
    expect(bad.success).toBe(false);
  });
});
