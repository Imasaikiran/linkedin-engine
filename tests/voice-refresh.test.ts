import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshVoiceCorpus } from '../src/voice-refresh.js';
import { clearCache } from '../src/lib/fetch.js';

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
<item><title>Sample</title><link>https://x/p1</link><description>post body for sample one with enough words to be useful</description><pubDate>Wed, 15 Apr 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('refreshVoiceCorpus', () => {
  it('writes per-handle .txt files + urls.json', async () => {
    clearCache();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(FEED, { status: 200 })));
    const dir = mkdtempSync(join(tmpdir(), 'voice-'));
    await refreshVoiceCorpus({
      handles: [{ name: 'akash', rss: 'https://test/akash', kind: 'linkedin' }],
      outDir: dir,
      samplesPerHandle: 1,
    });
    const externalDir = join(dir, 'external');
    const files = readdirSync(externalDir);
    expect(files.some((f) => f.endsWith('.txt'))).toBe(true);
    const urls = JSON.parse(readFileSync(join(externalDir, 'urls.json'), 'utf8'));
    expect(urls).toContain('https://x/p1');
  });
});
