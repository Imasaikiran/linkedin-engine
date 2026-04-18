import { describe, it, expect } from 'vitest';
import { parseRss } from '../../src/lib/rss.js';

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test</title>
  <item>
    <title>Hello</title>
    <link>https://x.com/a</link>
    <description>body text here</description>
    <author>jane</author>
    <pubDate>Wed, 15 Apr 2026 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

describe('parseRss', () => {
  it('maps RSS items to RawItem schema shape', async () => {
    const items = await parseRss(FEED, 'test-source');
    expect(items.length).toBe(1);
    expect(items[0]!.url).toBe('https://x.com/a');
    expect(items[0]!.title).toBe('Hello');
    expect(items[0]!.body).toContain('body text');
    expect(items[0]!.source).toBe('test-source');
    expect(items[0]!.published_at).toMatch(/2026-04-15/);
  });
});
