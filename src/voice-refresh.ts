import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { httpGet } from './lib/fetch.js';
import { parseRss } from './lib/rss.js';

export interface VoiceHandle { name: string; rss: string; kind: string; }

export async function refreshVoiceCorpus(opts: { handles: VoiceHandle[]; outDir: string; samplesPerHandle: number }): Promise<{ counts: Record<string, number> }> {
  const externalDir = join(opts.outDir, 'external');
  mkdirSync(externalDir, { recursive: true });

  const counts: Record<string, number> = {};
  const allUrls: string[] = [];

  for (const h of opts.handles) {
    try {
      const res = await httpGet(h.rss);
      const items = (await parseRss(res.body, h.name)).slice(0, opts.samplesPerHandle);
      for (const [idx, item] of items.entries()) {
        const fname = `${h.name}-${idx}.txt`;
        writeFileSync(join(externalDir, fname), `${item.title}\n\n${item.body.slice(0, 4000)}`);
        allUrls.push(item.url);
      }
      counts[h.name] = items.length;
    } catch (e) {
      counts[h.name] = 0;
    }
  }
  writeFileSync(join(externalDir, 'urls.json'), JSON.stringify(allUrls, null, 2));
  return { counts };
}
