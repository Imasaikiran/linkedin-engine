import { describe, it, expect } from 'vitest';
import { scoreCluster } from '../../src/stages/score.js';
import type { Cluster } from '../../src/lib/schema.js';

const now = new Date('2026-04-15T00:00:00Z').getTime();
const mk = (overrides: Partial<Cluster>): Cluster => ({
  topic: 't',
  items: [{ url: 'https://x/1', title: 't', body: '', published_at: '2026-04-14T00:00:00Z', source: 'anthropic', source_kind: 'lab_blog' }],
  earliest_date: '2026-04-14T00:00:00Z',
  source_count: 1,
  ...overrides,
});

describe('scoreCluster', () => {
  it('higher novelty for recent items', () => {
    const recent = scoreCluster(mk({ earliest_date: '2026-04-14T12:00:00Z' }), now);
    const old = scoreCluster(mk({ earliest_date: '2026-04-09T00:00:00Z' }), now);
    expect(recent.novelty).toBeGreaterThan(old.novelty);
  });

  it('lab_blog has higher authority than voice_handle', () => {
    const lab = scoreCluster(mk({}), now);
    const voice = scoreCluster(mk({ items: [{ url: 'https://x/1', title: 't', body: '', published_at: '2026-04-14T00:00:00Z', source: 'akash', source_kind: 'voice_handle' }] }), now);
    expect(lab.authority).toBeGreaterThan(voice.authority);
  });

  it('confirmation saturates at source_count >= 5', () => {
    const c5 = scoreCluster(mk({ source_count: 5 }), now);
    const c10 = scoreCluster(mk({ source_count: 10 }), now);
    expect(c5.confirmation).toBe(c10.confirmation);
    expect(c5.confirmation).toBe(1);
  });

  it('final_score in [0,1]', () => {
    const r = scoreCluster(mk({}), now);
    expect(r.final_score).toBeGreaterThanOrEqual(0);
    expect(r.final_score).toBeLessThanOrEqual(1);
  });
});
