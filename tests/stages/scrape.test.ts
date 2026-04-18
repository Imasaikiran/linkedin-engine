// tests/stages/scrape.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScrape } from '../../src/stages/scrape.js';
import { clearCache } from '../../src/lib/fetch.js';

beforeEach(() => { clearCache(); vi.restoreAllMocks(); });

const SOURCES_YAML = `
lab_blogs:
  - { name: anthropic, rss: "https://anthropic.test/rss.xml" }
curated_newsletters: []
voice_handles: []
hn:
  algolia_endpoint: "https://hn.test/api"
  query_terms: ["AI"]
  min_points: 100
  hours_back: 168
`;

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
<item><title>A</title><link>https://anthropic.test/news/a</link><description>body about claude</description><pubDate>Wed, 15 Apr 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('scrape stage', () => {
  it('writes per-source JSON to data/raw/<week>/', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'scrape-'));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('anthropic.test')) return new Response(FEED, { status: 200 });
      if (url.includes('hn.test')) return new Response(JSON.stringify({ hits: [] }), { status: 200 });
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await runScrape({ sourcesYaml: SOURCES_YAML, week: '2026-W17', dataDir, sinceDays: 30 });

    const weekDir = join(dataDir, 'raw', '2026-W17');
    const files = readdirSync(weekDir);
    expect(files).toContain('anthropic.json');
    const items = JSON.parse(readFileSync(join(weekDir, 'anthropic.json'), 'utf8'));
    expect(items.length).toBe(1);
    expect(items[0].url).toBe('https://anthropic.test/news/a');
  });
});
