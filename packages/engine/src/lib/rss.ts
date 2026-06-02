import Parser from 'rss-parser';
import { RawItemSchema } from './schema.js';
import type { RawItem } from './schema.js';

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'content', 'description'],
  },
});

export async function parseRss(xml: string, source: string): Promise<RawItem[]> {
  const feed = await parser.parseString(xml);
  const out: RawItem[] = [];
  for (const item of feed.items) {
    const url = item.link;
    if (!url) continue;
    const title = item.title ?? '';
    const body =
      (item['content:encoded'] as string | undefined)
      ?? (item.content as string | undefined)
      ?? (item['description'] as string | undefined)
      ?? item.contentSnippet
      ?? item.summary
      ?? '';
    const published = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : undefined);
    if (!title || !published) continue;
    const candidate = {
      url,
      title,
      body: typeof body === 'string' ? body : '',
      author: item.creator,
      published_at: published,
      source,
    };
    const parsed = RawItemSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
