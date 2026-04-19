import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ScoutOutputSchema,
  buildScoutUserPrompt,
  runScout,
} from '../../src/agents/scout.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_PAYLOAD = {
  trending_topics: [
    {
      title: 'Anthropic ships agent SDK 1.0',
      url: 'https://www.anthropic.com/news/agent-sdk',
      summary: 'Anthropic released Agent SDK 1.0 with built-in eval harness.',
      published_at: '2026-04-15T12:00:00.000Z',
    },
    {
      title: 'OpenAI responses API replaces assistants',
      url: 'https://openai.com/blog/responses-api',
      summary: 'OpenAI deprecated assistants in favor of responses API.',
    },
  ],
  recent_launches: [
    {
      title: 'Claude 4.7 launch',
      url: 'https://www.anthropic.com/news/claude-4-7',
      summary: 'Claude 4.7 ships with improved tool use and lower latency.',
    },
  ],
  engagement_signals: [
    'Posts about agent eval get 3x engagement this week',
  ],
};

const RSS_FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
<item><title>Lab post A</title><link>https://anthropic.test/news/a</link><description>body about claude 4.7</description><pubDate>Wed, 15 Apr 2026 00:00:00 GMT</pubDate></item>
<item><title>Lab post B</title><link>https://anthropic.test/news/b</link><description>another body about agents</description><pubDate>Tue, 14 Apr 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

function makeFakeClient(opts: {
  payload?: unknown;
  text?: string;
  throws?: Error;
  capture?: (input: any) => void;
} = {}) {
  const create = vi.fn(async (input: any) => {
    opts.capture?.(input);
    if (opts.throws) throw opts.throws;
    const text = opts.text ?? JSON.stringify(opts.payload ?? VALID_PAYLOAD);
    return {
      content: [{ type: 'text', text }],
      usage: { input_tokens: 200, output_tokens: 150 },
    };
  });
  return { messages: { create } } as any;
}

function brandWithWebSearch(enabled: boolean): Brand {
  const brand = loadBrand();
  return {
    ...brand,
    sources: {
      ...brand.sources,
      web_search: { ...brand.sources.web_search, enabled },
    },
  };
}

describe('buildScoutUserPrompt', () => {
  it('substitutes {today_year_month} in queries', () => {
    const out = buildScoutUserPrompt({
      queries: [
        'top AI PM posts {today_year_month}',
        'frontier launches {today_year_month} this week',
      ],
      queriesPerRun: 4,
      todayYearMonth: '2026-04',
    });
    expect(out).toContain('2026-04');
    expect(out).not.toContain('{today_year_month}');
    expect(out).toContain('top AI PM posts 2026-04');
  });

  it('caps suggested searches via queries_per_run text', () => {
    const out = buildScoutUserPrompt({
      queries: ['q1'],
      queriesPerRun: 4,
      todayYearMonth: '2026-04',
    });
    expect(out).toContain('up to 4 web_search calls');
  });
});

describe('runScout — web_search path', () => {
  it('returns ScoutOutput with valid shape and source=web_search', async () => {
    const brand = brandWithWebSearch(true);
    const client = makeFakeClient();
    const out = await runScout({ client, brand, today: new Date('2026-04-19T00:00:00Z') });
    expect(out.source).toBe('web_search');
    expect(out.trending_topics.length).toBe(2);
    expect(out.recent_launches.length).toBe(1);
    expect(out.engagement_signals.length).toBe(1);
    expect(out.cost_usd).toBeGreaterThan(0);
    const v = ScoutOutputSchema.safeParse(out);
    expect(v.success).toBe(true);
  });

  it('substitutes {today_year_month} into the user prompt sent to the client', async () => {
    const brand = brandWithWebSearch(true);
    let captured: any = null;
    const client = makeFakeClient({ capture: (input) => { captured = input; } });
    await runScout({ client, brand, today: new Date('2026-04-19T00:00:00Z') });
    expect(captured).not.toBeNull();
    const userMsg = captured.messages[0].content as string;
    expect(userMsg).toContain('2026-04');
    expect(userMsg).not.toContain('{today_year_month}');
  });

  it('passes brand-configured model + tool to client.messages.create', async () => {
    const brand = brandWithWebSearch(true);
    let captured: any = null;
    const client = makeFakeClient({ capture: (input) => { captured = input; } });
    await runScout({ client, brand, today: new Date('2026-04-19T00:00:00Z') });
    expect(captured.model).toBe(brand.agents.scout.model);
    expect(captured.max_tokens).toBe(brand.agents.scout.max_tokens);
    expect(Array.isArray(captured.tools)).toBe(true);
    expect(captured.tools[0].type).toBe('web_search_20250305');
    expect(captured.tools[0].name).toBe('web_search');
    expect(captured.tools[0].max_uses).toBe(brand.sources.web_search.queries_per_run);
  });

  it('throws with "scout" in message when LLM returns malformed JSON', async () => {
    const brand = brandWithWebSearch(true);
    const client = makeFakeClient({ text: 'totally not json no braces' });
    await expect(
      runScout({ client, brand, today: new Date('2026-04-19T00:00:00Z') }),
    ).rejects.toThrow(/scout/);
  });

  it('throws with "scout" in message when LLM returns wrong-shape JSON', async () => {
    const brand = brandWithWebSearch(true);
    const client = makeFakeClient({ payload: { trending_topics: 'not an array' } });
    await expect(
      runScout({ client, brand, today: new Date('2026-04-19T00:00:00Z') }),
    ).rejects.toThrow(/scout/);
  });
});

describe('runScout — RSS fallback path', () => {
  it('returns ScoutOutput with source=rss_fallback when web_search.enabled=false', async () => {
    const brand = brandWithWebSearch(false);
    const dir = mkdtempSync(path.join(tmpdir(), 'scout-rss-'));
    const sourcesPath = path.join(dir, 'sources.yaml');
    writeFileSync(
      sourcesPath,
      `lab_blogs:
  - { name: anthropic, rss: "https://anthropic.test/rss.xml" }
curated_newsletters: []
`,
      'utf8',
    );
    const fetchMock = vi.fn(async () => new Response(RSS_FEED, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const out = await runScout({
        client: makeFakeClient(),
        brand,
        today: new Date('2026-04-19T00:00:00Z'),
        rssConfigPath: sourcesPath,
      });
      expect(out.source).toBe('rss_fallback');
      expect(out.cost_usd).toBe(0);
      expect(out.trending_topics.length).toBeGreaterThan(0);
      expect(out.trending_topics[0]?.title).toBe('Lab post A');
      const v = ScoutOutputSchema.safeParse(out);
      expect(v.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to RSS when client.messages.create throws', async () => {
    const brand = brandWithWebSearch(true);
    const dir = mkdtempSync(path.join(tmpdir(), 'scout-rss-'));
    const sourcesPath = path.join(dir, 'sources.yaml');
    writeFileSync(
      sourcesPath,
      `lab_blogs:
  - { name: anthropic, rss: "https://anthropic.test/rss.xml" }
curated_newsletters: []
`,
      'utf8',
    );
    const fetchMock = vi.fn(async () => new Response(RSS_FEED, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = makeFakeClient({ throws: new Error('web_search down') });
      const out = await runScout({
        client,
        brand,
        today: new Date('2026-04-19T00:00:00Z'),
        rssConfigPath: sourcesPath,
      });
      // The fact that source === 'rss_fallback' (only set in runScoutViaRss)
      // proves the catch branch ran; the pino warn it logs is best-effort and
      // not asserted directly because pino's destination flushes async.
      expect(out.source).toBe('rss_fallback');
      expect(out.trending_topics[0]?.title).toBe('Lab post A');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
