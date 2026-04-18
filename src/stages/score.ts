import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cluster, ScoredCluster } from '../lib/schema.js';

const AUTHORITY: Record<string, number> = {
  lab_blog: 1.0,
  curated_newsletter: 0.6,
  hn: 0.4,
  voice_handle: 0.2,
};

export function scoreCluster(c: Cluster, nowMs: number): ScoredCluster {
  const ageHours = Math.max(0, (nowMs - Date.parse(c.earliest_date)) / 3_600_000);
  const novelty = Math.max(0, 1 - ageHours / 168);

  const authVals = c.items.map((i) => AUTHORITY[i.source_kind ?? 'curated_newsletter'] ?? 0.5);
  const authority = authVals.length > 0 ? Math.max(...authVals) : 0;

  const confirmation = Math.min(1, c.source_count / 5);

  const hnItem = c.items.find((i) => i.source === 'hn');
  let controversy = 0;
  if (hnItem) {
    const m = hnItem.body.match(/HN: (\d+) points, (\d+) comments/);
    if (m) {
      const points = parseInt(m[1]!, 10);
      const comments = parseInt(m[2]!, 10);
      controversy = Math.min(1, comments / Math.max(1, points));
    }
  }

  const final_score = 0.3 * novelty + 0.3 * authority + 0.2 * confirmation + 0.2 * controversy;
  return { ...c, novelty, authority, confirmation, controversy, final_score };
}

export function runScore(opts: { dataDir: string; week: string; topN?: number }): ScoredCluster[] {
  const inPath = join(opts.dataDir, 'clusters', `${opts.week}.json`);
  const clusters = JSON.parse(readFileSync(inPath, 'utf8')) as Cluster[];
  const now = Date.now();
  const scored = clusters
    .map((c) => scoreCluster(c, now))
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, opts.topN ?? 10);
  const outDir = join(opts.dataDir, 'scored');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${opts.week}.json`), JSON.stringify(scored, null, 2));
  return scored;
}
