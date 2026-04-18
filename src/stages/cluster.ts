import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { embedTexts, cosine } from '../lib/embed.js';
import { RawItemSchema } from '../lib/schema.js';
import type { Cluster, RawItem } from '../lib/schema.js';

export async function clusterItems(items: RawItem[], threshold = 0.85): Promise<Cluster[]> {
  if (items.length === 0) return [];
  const texts = items.map((i) => `${i.title}\n${i.body.slice(0, 1000)}`);
  const vecs = await embedTexts(texts);

  const assigned = new Array<number>(items.length).fill(-1);
  const clusterIds: number[][] = [];

  for (let i = 0; i < items.length; i++) {
    if (assigned[i] !== -1) continue;
    const groupIdx = clusterIds.length;
    assigned[i] = groupIdx;
    const group = [i];
    for (let j = i + 1; j < items.length; j++) {
      if (assigned[j] !== -1) continue;
      if (cosine(vecs[i]!, vecs[j]!) > threshold) {
        assigned[j] = groupIdx;
        group.push(j);
      }
    }
    clusterIds.push(group);
  }

  const clusters: Cluster[] = clusterIds.map((g) => {
    const groupItems = g.map((idx) => items[idx]!);
    const earliest = groupItems.reduce((min, it) => it.published_at < min ? it.published_at : min, groupItems[0]!.published_at);
    const sources = new Set(groupItems.map((i) => i.source));
    return {
      topic: groupItems[0]!.title.slice(0, 80),
      items: groupItems,
      earliest_date: earliest,
      source_count: sources.size,
    };
  });
  return clusters;
}

export async function runCluster(opts: { dataDir: string; week: string; threshold?: number }): Promise<Cluster[]> {
  const rawDir = join(opts.dataDir, 'raw', opts.week);
  const files = readdirSync(rawDir).filter((f) => f.endsWith('.json'));
  const all: RawItem[] = [];
  for (const f of files) {
    const arr = JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as unknown[];
    for (const item of arr) {
      const v = RawItemSchema.safeParse(item);
      if (v.success) all.push(v.data);
    }
  }
  const clusters = await clusterItems(all, opts.threshold ?? 0.85);
  const outDir = join(opts.dataDir, 'clusters');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${opts.week}.json`), JSON.stringify(clusters, null, 2));
  return clusters;
}
