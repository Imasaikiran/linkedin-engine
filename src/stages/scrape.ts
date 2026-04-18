import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { httpGet } from '../lib/fetch.js';
import { parseRss } from '../lib/rss.js';
import { RawItemSchema } from '../lib/schema.js';
import type { RawItem } from '../lib/schema.js';
import { makeLogger } from '../lib/log.js';

interface SourcesConfig {
  lab_blogs: { name: string; rss: string }[];
  curated_newsletters: { name: string; rss: string }[];
  voice_handles: { name: string; rss: string; kind: string }[];
  hn: { algolia_endpoint: string; query_terms: string[]; min_points: number; hours_back: number };
}

interface ScrapeOpts {
  sourcesYaml: string;
  week: string;
  dataDir: string;
  sinceDays?: number;
}

export async function runScrape(opts: ScrapeOpts): Promise<{ counts: Record<string, number>; errors: { source: string; error: string }[] }> {
  const cfg = parseYaml(opts.sourcesYaml) as SourcesConfig;
  const log = makeLogger({ name: 'scrape' });
  const outDir = join(opts.dataDir, 'raw', opts.week);
  mkdirSync(outDir, { recursive: true });

  const counts: Record<string, number> = {};
  const errors: { source: string; error: string }[] = [];
  const since = Date.now() - (opts.sinceDays ?? 7) * 24 * 60 * 60 * 1000;

  const allRss = [
    ...cfg.lab_blogs.map((s) => ({ ...s, kind: 'lab_blog' as const })),
    ...cfg.curated_newsletters.map((s) => ({ ...s, kind: 'curated_newsletter' as const })),
    ...cfg.voice_handles.map((s) => ({ ...s, kind: 'voice_handle' as const })),
  ];

  await Promise.all(allRss.map(async (src) => {
    try {
      const res = await httpGet(src.rss);
      const items = await parseRss(res.body, src.name);
      const filtered: RawItem[] = items
        .filter((i) => Date.parse(i.published_at) >= since)
        .map((i) => ({ ...i, source_kind: src.kind }))
        .filter((i) => RawItemSchema.safeParse(i).success)
        .map((i) => RawItemSchema.parse(i));
      writeFileSync(join(outDir, `${src.name}.json`), JSON.stringify(filtered, null, 2));
      counts[src.name] = filtered.length;
      log.info({ source: src.name, count: filtered.length }, 'scraped');
    } catch (e: any) {
      log.warn({ source: src.name, err: e.message }, 'source failed');
      errors.push({ source: src.name, error: e.message });
    }
  }));

  // HN
  try {
    const url = `${cfg.hn.algolia_endpoint}?tags=story&hitsPerPage=50&numericFilters=points>${cfg.hn.min_points},created_at_i>${Math.floor((Date.now() - cfg.hn.hours_back * 3600 * 1000) / 1000)}&query=${encodeURIComponent(cfg.hn.query_terms.join(' '))}`;
    const res = await httpGet(url);
    const json = JSON.parse(res.body) as { hits: any[] };
    const items: RawItem[] = json.hits.flatMap((h) => {
      if (!h.url) return [];
      const candidate = {
        url: h.url,
        title: h.title ?? '',
        body: `${h.title ?? ''}\n\nHN: ${h.points} points, ${h.num_comments} comments`,
        author: h.author,
        published_at: new Date(h.created_at_i * 1000).toISOString(),
        source: 'hn',
        source_kind: 'hn' as const,
      };
      const v = RawItemSchema.safeParse(candidate);
      return v.success ? [v.data] : [];
    });
    writeFileSync(join(outDir, 'hn.json'), JSON.stringify(items, null, 2));
    counts['hn'] = items.length;
  } catch (e: any) {
    log.warn({ source: 'hn', err: e.message }, 'hn failed');
    errors.push({ source: 'hn', error: e.message });
  }

  return { counts, errors };
}
