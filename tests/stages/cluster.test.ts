// tests/stages/cluster.test.ts
import { describe, it, expect, vi } from 'vitest';
import { clusterItems } from '../../src/stages/cluster.js';
import type { RawItem } from '../../src/lib/schema.js';

vi.mock('../../src/lib/embed.js', () => ({
  embedTexts: vi.fn(async (xs: string[]) => xs.map((x) => x.toLowerCase().includes('claude') ? [1, 0] : [0, 1])),
  cosine: (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!,
}));

const mk = (url: string, title: string, source = 's'): RawItem => ({
  url, title, body: title, published_at: '2026-04-15T00:00:00Z', source,
});

describe('clusterItems', () => {
  it('groups items with cosine > 0.85', async () => {
    const items = [
      mk('https://a/1', 'Claude 4.7 release', 'a'),
      mk('https://b/1', 'Claude 4.7 reaction', 'b'),
      mk('https://c/1', 'GPT-5 leaked specs'),
    ];
    const clusters = await clusterItems(items, 0.85);
    expect(clusters.length).toBe(2);
    const claudeCluster = clusters.find((c) => c.items.some((i) => i.title.includes('4.7')))!;
    expect(claudeCluster.items.length).toBe(2);
    expect(claudeCluster.source_count).toBe(2);
  });
});
