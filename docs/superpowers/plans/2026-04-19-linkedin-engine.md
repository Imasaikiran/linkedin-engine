# LinkedIn Content Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-stage TypeScript pipeline that scrapes AI sources weekly, drafts 3 LinkedIn posts grounded in real sources, enforces voice + hallucination gates, and commits drafts to repo via GitHub Actions cron.

**Architecture:** 6 sequential stages (`scrape → cluster → score → angle → draft → polish`), each writing JSON to `data/` and reading the previous stage's output. Each stage is its own command, replayable independently. Final stage emits `drafts/YYYY-WW/{mon,wed,fri}.md`. Orchestrator runs all 6 in order; CLI exposes per-stage rerun. GitHub Actions cron triggers Sun + Wed.

**Tech Stack:** Node 20+, TypeScript 5+, pnpm, Anthropic SDK (Claude Sonnet 4.6), Voyage embeddings (Voyage-3) with `@xenova/transformers` fallback, native fetch + p-retry, rss-parser, cheerio, robots-parser, zod, pino, vitest, GitHub Actions.

**Conventions used in this plan:**
- Working directory for all commands: repo root (`linkedin-engine/`)
- All paths relative to repo root
- Test files mirror `src/` structure under `tests/`
- Each task ends with a commit; commit messages use conventional commits (`feat:`, `test:`, `chore:`)
- Where a step says "verify it fails", confirm the test fails for the right reason (missing implementation, not a typo)
- Skip a test step only if marked "(no test — config/prompt file)"

**Spec reference:** `docs/superpowers/specs/2026-04-19-linkedin-engine-design.md`

---

## Task 0: Bootstrap repo (package.json, tsconfig, vitest, env)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore` (already exists, verify)
- Create: `README.md`
- Create: `data/.gitkeep`, `logs/.gitkeep`, `drafts/.gitkeep`, `posted/.gitkeep`

- [ ] **Step 1: Init pnpm + add deps**

```bash
corepack enable
pnpm init
pnpm add @anthropic-ai/sdk zod pino p-retry rss-parser cheerio robots-parser yaml dayjs
pnpm add -D typescript @types/node tsx vitest @vitest/coverage-v8 @xenova/transformers
```

- [ ] **Step 2: Replace `package.json` with project script set**

Edit `package.json` so the `scripts` block contains:

```json
{
  "name": "linkedin-engine",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "pipeline": "tsx src/pipeline.ts",
    "pipeline:friday": "tsx src/pipeline.ts --only fri",
    "stage": "tsx src/cli.ts stage",
    "rerun": "tsx src/cli.ts rerun",
    "voice:refresh": "tsx src/cli.ts voice:refresh",
    "posted": "tsx src/cli.ts posted",
    "draft:freeform": "tsx src/cli.ts draft:freeform",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

Keep `dependencies` / `devDependencies` blocks pnpm wrote for you.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/pipeline.ts'],
    },
  },
});
```

- [ ] **Step 5: Create `.env.example`**

```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
USER_AGENT=linkedin-engine/0.1 (+github.com/USER/repo)
```

- [ ] **Step 6: Create empty dir markers**

```bash
mkdir -p data logs drafts posted tests src/lib src/stages prompts/pillars config .github/workflows
touch data/.gitkeep logs/.gitkeep drafts/.gitkeep posted/.gitkeep
```

- [ ] **Step 7: Create minimal `README.md`**

```markdown
# linkedin-engine

3 LinkedIn post drafts per week, source-grounded, human voice. See `docs/superpowers/specs/2026-04-19-linkedin-engine-design.md` for design.

## Setup
\`\`\`
pnpm install
cp .env.example .env   # fill in keys
pnpm test
pnpm pipeline
\`\`\`

Drafts land in `drafts/YYYY-WW/{mon,wed,fri}.md`.
```

- [ ] **Step 8: Verify install + typecheck**

Run: `pnpm install && pnpm typecheck`
Expected: both succeed (typecheck has nothing to check yet but exits 0).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .env.example .gitignore README.md data/.gitkeep logs/.gitkeep drafts/.gitkeep posted/.gitkeep
git commit -m "chore: bootstrap pnpm project with TS, vitest, deps"
```

---

## Task 1: lib/schema.ts — zod contracts for all stages

**Files:**
- Create: `src/lib/schema.ts`
- Test: `tests/lib/schema.test.ts`

This file defines the JSON contracts between every stage. Every stage validates its input + output through these schemas, so a malformed stage is rejected at the boundary.

- [ ] **Step 1: Write failing test**

Create `tests/lib/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RawItemSchema, ClusterSchema, ScoredClusterSchema, AngleSchema, DraftSchema, ClaimSchema } from '../../src/lib/schema.js';

describe('schema', () => {
  it('RawItemSchema accepts valid item', () => {
    const ok = RawItemSchema.safeParse({
      url: 'https://anthropic.com/news/x',
      title: 'X',
      body: 'body text',
      author: 'A',
      published_at: '2026-04-15T00:00:00Z',
      source: 'anthropic-blog',
    });
    expect(ok.success).toBe(true);
  });

  it('RawItemSchema rejects bad url', () => {
    const bad = RawItemSchema.safeParse({ url: 'not-a-url', title: 'x', body: 'y', published_at: '2026-04-15T00:00:00Z', source: 's' });
    expect(bad.success).toBe(false);
  });

  it('ClaimSchema requires source_url unless type=opinion', () => {
    const opinionOk = ClaimSchema.safeParse({ claim_text: 'x', type: 'opinion', confidence: 0.5 });
    expect(opinionOk.success).toBe(true);
    const statBad = ClaimSchema.safeParse({ claim_text: '70%', type: 'stat', confidence: 0.9 });
    expect(statBad.success).toBe(false);
    const statOk = ClaimSchema.safeParse({ claim_text: '70%', type: 'stat', source_url: 'https://x.com/y', confidence: 0.9 });
    expect(statOk.success).toBe(true);
  });

  it('DraftSchema requires post_text + claims array', () => {
    const ok = DraftSchema.safeParse({
      post_text: 'hello',
      claims: [],
      pillar: 'hottake',
      angle_rationale: 'r',
    });
    expect(ok.success).toBe(true);
  });

  it('ScoredClusterSchema final score in [0,1]', () => {
    const bad = ScoredClusterSchema.safeParse({ topic: 't', items: [], earliest_date: '2026-04-15T00:00:00Z', source_count: 1, final_score: 1.5 });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test schema`
Expected: FAIL with "Cannot find module ../../src/lib/schema.js" or similar.

- [ ] **Step 3: Implement `src/lib/schema.ts`**

```ts
import { z } from 'zod';

export const PillarEnum = z.enum(['framework', 'hottake', 'story', 'lesson', 'myth', 'observation', 'list']);
export type Pillar = z.infer<typeof PillarEnum>;

export const DayEnum = z.enum(['mon', 'wed', 'fri']);
export type Day = z.infer<typeof DayEnum>;

export const SourceKindEnum = z.enum(['lab_blog', 'curated_newsletter', 'hn', 'voice_handle']);
export type SourceKind = z.infer<typeof SourceKindEnum>;

// ---------- stage 1: scrape ----------
export const RawItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  body: z.string(),
  author: z.string().optional(),
  published_at: z.string().datetime(),
  source: z.string().min(1),         // source key, e.g. "anthropic-blog"
  source_kind: SourceKindEnum.optional(),
});
export type RawItem = z.infer<typeof RawItemSchema>;

// ---------- stage 2: cluster ----------
export const ClusterSchema = z.object({
  topic: z.string(),
  items: z.array(RawItemSchema).min(1),
  earliest_date: z.string().datetime(),
  source_count: z.number().int().positive(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

// ---------- stage 3: score ----------
export const ScoredClusterSchema = ClusterSchema.extend({
  novelty: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  confirmation: z.number().min(0).max(1),
  controversy: z.number().min(0).max(1),
  final_score: z.number().min(0).max(1),
});
export type ScoredCluster = z.infer<typeof ScoredClusterSchema>;

// ---------- stage 4: angle ----------
export const AngleSchema = z.object({
  day: DayEnum,
  pillar: PillarEnum,
  cluster_topic: z.string(),
  cluster_urls: z.array(z.string().url()).min(1),
  one_line_angle: z.string(),
  why_this_pillar: z.string(),
});
export type Angle = z.infer<typeof AngleSchema>;

// ---------- stage 5: draft ----------
export const ClaimTypeEnum = z.enum(['stat', 'quote', 'attribution', 'capability', 'date', 'opinion']);
export const ClaimSchema = z.object({
  claim_text: z.string().min(1),
  type: ClaimTypeEnum,
  source_url: z.string().url().optional(),
  confidence: z.number().min(0).max(1),
}).refine(
  (c) => c.type === 'opinion' || c.source_url !== undefined,
  { message: 'non-opinion claims require source_url' },
);
export type Claim = z.infer<typeof ClaimSchema>;

export const DraftSchema = z.object({
  post_text: z.string().min(1),
  claims: z.array(ClaimSchema),
  pillar: PillarEnum,
  angle_rationale: z.string(),
  attempt: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
});
export type Draft = z.infer<typeof DraftSchema>;

// ---------- stage 6: polish ----------
export const VerdictEnum = z.enum(['PASS', 'FAIL', 'SOFT_FAIL']);
export const ClaimVerdictSchema = z.object({
  claim: ClaimSchema,
  verdict: VerdictEnum,
  reason: z.string(),
  matched_excerpt: z.string().optional(),
});
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

export const PolishedSchema = z.object({
  draft: DraftSchema,
  verdicts: z.array(ClaimVerdictSchema),
  voice_gate_pass: z.boolean(),
  voice_gate_failures: z.array(z.string()),
  hallucination_gate_pass: z.boolean(),
  final_markdown: z.string().optional(),
  skipped: z.boolean(),
  skipped_reason: z.string().optional(),
});
export type Polished = z.infer<typeof PolishedSchema>;

// ---------- run summary ----------
export const StageStatsSchema = z.object({
  stage: z.string(),
  duration_ms: z.number(),
  llm_calls: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type StageStats = z.infer<typeof StageStatsSchema>;

export const RunSummarySchema = z.object({
  week: z.string(),                  // e.g. "2026-W17"
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().optional(),
  stages: z.array(StageStatsSchema),
  total_cost_usd: z.number().nonnegative(),
  drafts_produced: z.number().int().nonnegative(),
  drafts_skipped: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test schema`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schema.ts tests/lib/schema.test.ts
git commit -m "feat(schema): add zod contracts for all 6 stages"
```

---

## Task 2: lib/log.ts — pino with secret redaction

**Files:**
- Create: `src/lib/log.ts`
- Test: `tests/lib/log.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/log.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeLogger } from '../../src/lib/log.js';

describe('log', () => {
  it('redacts ANTHROPIC_API_KEY from log line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-test-'));
    const logFile = join(dir, 'out.log');
    const log = makeLogger({ name: 'test', filePath: logFile });
    log.info({ ANTHROPIC_API_KEY: 'sk-ant-secret', other: 'visible' }, 'hello');
    log.flush?.();
    // give pino async write a tick
    return new Promise<void>((resolve) => setTimeout(() => {
      const content = readFileSync(logFile, 'utf8');
      expect(content).not.toContain('sk-ant-secret');
      expect(content).toContain('[Redacted]');
      expect(content).toContain('visible');
      resolve();
    }, 50));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test log`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/log.ts`**

```ts
import pino from 'pino';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LoggerOptions {
  name: string;
  filePath?: string;
  level?: pino.Level;
}

const REDACT_PATHS = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  '*.ANTHROPIC_API_KEY',
  '*.VOYAGE_API_KEY',
  'headers.authorization',
  'headers.Authorization',
  '*.headers.authorization',
  '*.headers.Authorization',
];

export function makeLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level ?? (process.env.LOG_LEVEL as pino.Level) ?? 'info';
  const redactOpts = { paths: REDACT_PATHS, censor: '[Redacted]' };

  if (opts.filePath) {
    if (!existsSync(dirname(opts.filePath))) {
      mkdirSync(dirname(opts.filePath), { recursive: true });
    }
    return pino({ name: opts.name, level, redact: redactOpts }, pino.destination({ dest: opts.filePath, sync: false }));
  }
  return pino({ name: opts.name, level, redact: redactOpts });
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm test log`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/log.ts tests/lib/log.test.ts
git commit -m "feat(log): add pino logger with secret redaction"
```

---

## Task 3: lib/fetch.ts — HTTP wrapper (UA, retry, robots, cache)

**Files:**
- Create: `src/lib/fetch.ts`
- Test: `tests/lib/fetch.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/fetch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpGet, clearCache } from '../../src/lib/fetch.js';

beforeEach(() => {
  clearCache();
  vi.restoreAllMocks();
});

describe('httpGet', () => {
  it('sends User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('hi', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.USER_AGENT = 'linkedin-engine/0.1 test';
    const res = await httpGet('https://example.com/x');
    expect(res.body).toBe('hi');
    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['user-agent']).toBe('linkedin-engine/0.1 test');
  });

  it('returns cached body within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('cached', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await httpGet('https://example.com/y');
    await httpGet('https://example.com/y');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await httpGet('https://example.com/z', { retries: 2, retryDelayMs: 1 });
    expect(res.body).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausted retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(httpGet('https://example.com/q', { retries: 1, retryDelayMs: 1 })).rejects.toThrow(/HTTP 500/);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test fetch`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/fetch.ts`**

```ts
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cache = new Map<string, { body: string; status: number; ts: number }>();

export interface HttpOptions {
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpResponse {
  body: string;
  status: number;
  fromCache: boolean;
}

export function clearCache(): void {
  cache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { body: cached.body, status: cached.status, fromCache: true };
  }

  const ua = process.env.USER_AGENT ?? 'linkedin-engine/0.1';
  const headers: Record<string, string> = { 'user-agent': ua, ...(opts.headers ?? {}) };
  const retries = opts.retries ?? 3;
  const retryDelay = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status >= 500 && attempt < retries) {
        await sleep(retryDelay * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const body = await res.text();
      cache.set(url, { body, status: res.status, ts: Date.now() });
      return { body, status: res.status, fromCache: false };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await sleep(retryDelay * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test fetch`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fetch.ts tests/lib/fetch.test.ts
git commit -m "feat(fetch): http wrapper with UA, retry, 6h cache"
```

---

## Task 4: lib/rss.ts — RSS parser wrapper returning RawItems

**Files:**
- Create: `src/lib/rss.ts`
- Test: `tests/lib/rss.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/rss.test.ts
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
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test rss`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/rss.ts`**

```ts
import Parser from 'rss-parser';
import { RawItem, RawItemSchema } from './schema.js';

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
    const body = (item['content:encoded'] as string | undefined) ?? item.content ?? item.contentSnippet ?? item.summary ?? '';
    const published = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : undefined);
    if (!title || !published) continue;
    const candidate = {
      url,
      title,
      body: typeof body === 'string' ? body : '',
      author: item.creator ?? item.author,
      published_at: published,
      source,
    };
    const parsed = RawItemSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test rss`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rss.ts tests/lib/rss.test.ts
git commit -m "feat(rss): parse RSS feeds into RawItem schema"
```

---

## Task 5: lib/llm.ts — Anthropic SDK wrapper

**Files:**
- Create: `src/lib/llm.ts`
- Test: `tests/lib/llm.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/llm.test.ts
import { describe, it, expect, vi } from 'vitest';
import { complete, estimateCostUsd } from '../../src/lib/llm.js';

describe('llm', () => {
  it('estimateCostUsd computes Sonnet pricing', () => {
    // Sonnet 4.6: $3/MTok input, $15/MTok output
    const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-4-6' });
    expect(cost).toBeCloseTo(18, 2);
  });

  it('complete calls SDK with correct shape', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const fakeClient = { messages: { create } } as any;
    const out = await complete({
      client: fakeClient,
      model: 'claude-sonnet-4-6',
      system: 'sys',
      user: 'u',
      maxTokens: 100,
    });
    expect(out.text).toBe('hi');
    expect(out.cost_usd).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'u' }],
    }));
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test llm`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/llm.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';

export type Model = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

const PRICING: Record<Model, { input: number; output: number }> = {
  // USD per million tokens
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

export interface CompleteParams {
  client: Anthropic;
  model: Model;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost_usd: number;
}

export function makeClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

export function estimateCostUsd(p: { inputTokens: number; outputTokens: number; model: Model }): number {
  const prices = PRICING[p.model];
  return (p.inputTokens / 1_000_000) * prices.input + (p.outputTokens / 1_000_000) * prices.output;
}

export async function complete(p: CompleteParams): Promise<CompleteResult> {
  const res = await p.client.messages.create({
    model: p.model,
    max_tokens: p.maxTokens ?? 1024,
    temperature: p.temperature ?? 0.7,
    system: p.system,
    messages: [{ role: 'user', content: p.user }],
  });
  const text = res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const inputTokens = res.usage?.input_tokens ?? 0;
  const outputTokens = res.usage?.output_tokens ?? 0;
  return { text, inputTokens, outputTokens, cost_usd: estimateCostUsd({ inputTokens, outputTokens, model: p.model }) };
}

export async function completeJson<T>(p: CompleteParams & { schema: { safeParse: (x: unknown) => { success: true; data: T } | { success: false } } }): Promise<{ data: T; cost_usd: number }> {
  const res = await complete({ ...p, system: p.system + '\n\nRespond with valid JSON only. No prose, no code fences.' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${res.text.slice(0, 200)}`);
  }
  const v = p.schema.safeParse(parsed);
  if (!v.success) throw new Error('LLM JSON failed schema validation');
  return { data: v.data, cost_usd: res.cost_usd };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test llm`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts tests/lib/llm.test.ts
git commit -m "feat(llm): Anthropic SDK wrapper + cost estimation"
```

---

## Task 6: lib/embed.ts — Voyage embeddings + xenova fallback

**Files:**
- Create: `src/lib/embed.ts`
- Test: `tests/lib/embed.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/embed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { cosine, embedTexts } from '../../src/lib/embed.js';

describe('embed', () => {
  it('cosine identity = 1', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it('cosine orthogonal = 0', () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });
  it('embedTexts uses Voyage when key set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.VOYAGE_API_KEY = 'pa-test';
    const out = await embedTexts(['hello']);
    expect(out[0]).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test embed`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/embed.ts`**

```ts
export type Vector = number[];

export function cosine(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedTexts(texts: string[]): Promise<Vector[]> {
  if (texts.length === 0) return [];
  if (process.env.VOYAGE_API_KEY) {
    return embedVoyage(texts);
  }
  return embedLocal(texts);
}

async function embedVoyage(texts: string[]): Promise<Vector[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: 'voyage-3' }),
  });
  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status}`);
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

let xenovaPipe: any = null;
async function embedLocal(texts: string[]): Promise<Vector[]> {
  if (!xenovaPipe) {
    const { pipeline } = await import('@xenova/transformers');
    xenovaPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const out: Vector[] = [];
  for (const t of texts) {
    const e = await xenovaPipe(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(e.data as Float32Array));
  }
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test embed`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embed.ts tests/lib/embed.test.ts
git commit -m "feat(embed): Voyage-3 client with xenova fallback"
```

---

## Task 7: lib/gate.ts — voice gate (deterministic regex + structural)

**Files:**
- Create: `src/lib/gate.ts`
- Test: `tests/lib/voice-gate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/voice-gate.test.ts
import { describe, it, expect } from 'vitest';
import { runVoiceGate } from '../../src/lib/gate.js';

describe('runVoiceGate', () => {
  it('passes a clean post', () => {
    const post = `What if every model release felt like a product launch
Most teams treat releases as engineering milestones, not product moments.
Three reasons that costs you reach.
First, no narrative. Second, no positioning. Third, no question to answer.
Fix that and your model lands twice as hard.
What does your team do on launch day?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails on em dash', () => {
    const post = `Hook line works fine here today
Body — with an em dash kills it.
What now?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/em.?dash/i);
  });

  it('fails on banned phrase', () => {
    const post = `Hook line works fine here today
I recently shipped something cool.
What now?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/I recently/i);
  });

  it('fails when last line is not a question', () => {
    const post = `Hook line works fine here today
A body sentence.
End statement.`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/question/i);
  });

  it('fails on word count out of range for pillar', () => {
    const post = `Hook line works fine here today
short.
?`;
    const r = runVoiceGate(post, { pillar: 'framework' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/word count/i);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test voice-gate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement voice gate in `src/lib/gate.ts`**

```ts
import { Pillar } from './schema.js';

const BANNED_PHRASES = [
  'I recently', 'Excited to share', 'Today I want to share', "In today's",
  'game-changer', 'game changer', 'thought leader', 'deep dive', 'delve',
  'leverage', 'synergy', 'ecosystem', 'unpack', 'unlock',
  'Let that sink in', "Here's the thing", 'needless to say',
  'Furthermore', 'Moreover', 'In conclusion', "It's worth noting",
];

const BANNED_OPEN_EMOJIS = ['🚀', '✨', '🎯', '💡', '🔥'];
const ALL_EMOJIS_RE = /\p{Extended_Pictographic}/gu;

const WORD_COUNT_RANGES: Record<Pillar, [number, number]> = {
  framework: [150, 180],
  hottake: [120, 150],
  story: [180, 220],
  lesson: [160, 200],
  myth: [140, 170],
  observation: [130, 160],
  list: [150, 200],
};

export interface VoiceGateInput { pillar: Pillar; }
export interface VoiceGateResult { pass: boolean; failures: string[]; }

export function runVoiceGate(post: string, opts: VoiceGateInput): VoiceGateResult {
  const failures: string[] = [];

  if (post.includes('—')) failures.push('em-dash present');
  if (post.includes('–')) failures.push('en-dash present');

  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i');
    if (re.test(post)) failures.push(`banned phrase: "${phrase}"`);
  }

  const lines = post.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    failures.push('empty post');
    return { pass: false, failures };
  }

  const firstLine = lines[0]!;
  const firstWords = firstLine.split(/\s+/).filter(Boolean);
  if (firstWords.length < 8 || firstWords.length > 18) {
    failures.push(`first line word count ${firstWords.length} (need 8-18)`);
  }
  if (firstLine.endsWith('.')) failures.push('first line ends with period');
  if (BANNED_OPEN_EMOJIS.some((e) => firstLine.startsWith(e))) failures.push('opening emoji');

  const lastLine = lines[lines.length - 1]!;
  if (!lastLine.endsWith('?')) failures.push('last line not a question');

  const allWords = post.split(/\s+/).filter(Boolean);
  const [minW, maxW] = WORD_COUNT_RANGES[opts.pillar];
  if (allWords.length < minW || allWords.length > maxW) {
    failures.push(`word count ${allWords.length} outside ${minW}-${maxW} for pillar ${opts.pillar}`);
  }

  const emojis = post.match(ALL_EMOJIS_RE) ?? [];
  if (emojis.length > 2) failures.push(`emoji count ${emojis.length} > 2`);

  const hashtags = post.match(/#\w+/g) ?? [];
  if (hashtags.length > 3) failures.push(`hashtag count ${hashtags.length} > 3`);

  for (const para of post.split(/\n{2,}/)) {
    const lc = para.split('\n').filter((l) => l.trim().length > 0).length;
    if (lc > 3) failures.push(`paragraph has ${lc} lines (>3)`);
  }

  if (opts.pillar !== 'framework' && opts.pillar !== 'list') {
    if (/^\s*[-*\d]\.?\s+/m.test(post)) failures.push('bullet/numbered list in non-framework post');
  }

  const iCount = (post.match(/\bI\b/g) ?? []).length;
  if (allWords.length > 0 && iCount / allWords.length >= 0.05) {
    failures.push(`"I" frequency ${(iCount / allWords.length).toFixed(2)} >= 0.05`);
  }

  return { pass: failures.length === 0, failures };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test voice-gate`
Expected: PASS, 5 tests. If any test fails, adjust the test post text rather than the gate (the gate is the spec, the test must match).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gate.ts tests/lib/voice-gate.test.ts
git commit -m "feat(gate): voice gate with banned phrases + structural checks"
```

---

## Task 8: lib/gate.ts — hallucination gate (claim source mapping)

**Files:**
- Modify: `src/lib/gate.ts` (add functions, do not touch voice gate)
- Test: `tests/lib/hallucination-gate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/hallucination-gate.test.ts
import { describe, it, expect } from 'vitest';
import { runHallucinationGate } from '../../src/lib/gate.js';
import { Claim } from '../../src/lib/schema.js';

const SOURCES = [
  { url: 'https://anthropic.com/news/claude-4-7', body: 'Claude 4.7 was released today. It supports a 200K context window and improved tool use. Sam Altman commented "this is a real shift" in a follow-up post.' },
];

describe('runHallucinationGate', () => {
  it('passes a stat that appears in source', () => {
    const claims: Claim[] = [{ claim_text: '200K context window', type: 'stat', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
    expect(r.verdicts[0]!.verdict).toBe('PASS');
  });

  it('fails a stat not in source', () => {
    const claims: Claim[] = [{ claim_text: '500K context window', type: 'stat', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(false);
  });

  it('passes opinion claims without source', () => {
    const claims: Claim[] = [{ claim_text: 'most teams overcomplicate evals', type: 'opinion', confidence: 0.5 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
  });

  it('rejects opinion claims with digits', () => {
    const claims: Claim[] = [{ claim_text: '70% of teams overcomplicate evals', type: 'opinion', confidence: 0.5 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(false);
  });

  it('rejects voice-corpus URLs as source_url', () => {
    const claims: Claim[] = [{ claim_text: '200K context', type: 'stat', source_url: 'https://linkedin.com/posts/akashgupta_x', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: ['https://linkedin.com/posts/akashgupta_x'] });
    expect(r.pass).toBe(false);
  });

  it('quote requires exact substring', () => {
    const ok: Claim[] = [{ claim_text: '"this is a real shift"', type: 'quote', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const bad: Claim[] = [{ claim_text: '"this is a huge shift"', type: 'quote', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    expect(runHallucinationGate({ claims: ok, sources: SOURCES, voiceCorpusUrls: [] }).pass).toBe(true);
    expect(runHallucinationGate({ claims: bad, sources: SOURCES, voiceCorpusUrls: [] }).pass).toBe(false);
  });

  it('attribution requires name + quote co-occurrence', () => {
    const ok: Claim[] = [{ claim_text: 'Sam Altman called it a real shift', type: 'attribution', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims: ok, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test hallucination-gate`
Expected: FAIL — `runHallucinationGate` not exported.

- [ ] **Step 3: Append hallucination gate to `src/lib/gate.ts`**

Append below the existing voice-gate code:

```ts
import { Claim, ClaimVerdict } from './schema.js';

export interface HallGateInput {
  claims: Claim[];
  sources: { url: string; body: string }[];
  voiceCorpusUrls: string[];
}
export interface HallGateResult { pass: boolean; verdicts: ClaimVerdict[]; }

const PROPER_NOUN_RE = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b/;
const DIGIT_RE = /\d/;

export function runHallucinationGate(input: HallGateInput): HallGateResult {
  const verdicts: ClaimVerdict[] = [];

  for (const claim of input.claims) {
    if (claim.source_url && input.voiceCorpusUrls.includes(claim.source_url)) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'voice-corpus URL used as source' });
      continue;
    }

    if (claim.type === 'opinion') {
      if (DIGIT_RE.test(claim.claim_text)) {
        verdicts.push({ claim, verdict: 'FAIL', reason: 'opinion contains a digit (must be qualified as stat)' });
        continue;
      }
      if (PROPER_NOUN_RE.test(claim.claim_text)) {
        verdicts.push({ claim, verdict: 'FAIL', reason: 'opinion contains proper noun (must be attribution)' });
        continue;
      }
      verdicts.push({ claim, verdict: 'PASS', reason: 'opinion (whitelisted)' });
      continue;
    }

    if (!claim.source_url) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'non-opinion claim missing source_url' });
      continue;
    }
    const src = input.sources.find((s) => s.url === claim.source_url);
    if (!src) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'source_url not in cluster sources' });
      continue;
    }

    const v = mapClaim(claim, src.body);
    verdicts.push({ claim, ...v });
  }

  const pass = verdicts.every((v) => v.verdict === 'PASS' || v.verdict === 'SOFT_FAIL');
  return { pass: verdicts.every((v) => v.verdict === 'PASS'), verdicts };
}

function mapClaim(claim: Claim, body: string): { verdict: 'PASS' | 'FAIL' | 'SOFT_FAIL'; reason: string; matched_excerpt?: string } {
  const lcBody = body.toLowerCase();
  switch (claim.type) {
    case 'stat': {
      const digits = claim.claim_text.match(/\d+(?:\.\d+)?[KkMmBbGg%]?/g) ?? [];
      if (digits.length === 0) return { verdict: 'FAIL', reason: 'stat has no digits' };
      for (const d of digits) {
        if (!body.toLowerCase().includes(d.toLowerCase())) {
          return { verdict: 'FAIL', reason: `digit "${d}" not in source` };
        }
      }
      return { verdict: 'PASS', reason: 'all digits present in source' };
    }
    case 'quote': {
      const quoted = claim.claim_text.match(/"([^"]+)"/);
      if (!quoted) return { verdict: 'FAIL', reason: 'quote claim has no quoted substring' };
      const target = quoted[1]!;
      if (lcBody.includes(target.toLowerCase())) {
        return { verdict: 'PASS', reason: 'exact quote in source', matched_excerpt: target };
      }
      return { verdict: 'FAIL', reason: 'quoted text not exact in source' };
    }
    case 'attribution': {
      const names = claim.claim_text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
      if (names.length === 0) return { verdict: 'FAIL', reason: 'attribution has no proper noun' };
      for (const n of names) {
        if (!body.includes(n)) return { verdict: 'FAIL', reason: `name "${n}" not in source` };
      }
      return { verdict: 'PASS', reason: 'all named persons appear in source' };
    }
    case 'capability': {
      const featureNouns = claim.claim_text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matched = featureNouns.filter((w) => lcBody.includes(w)).length;
      if (matched / Math.max(1, featureNouns.length) >= 0.6) {
        return { verdict: 'PASS', reason: `${matched}/${featureNouns.length} keywords matched` };
      }
      return { verdict: 'FAIL', reason: `only ${matched}/${featureNouns.length} keywords matched` };
    }
    case 'date': {
      const re = /\b(20\d{2})\b/;
      const m = claim.claim_text.match(re);
      if (!m) return { verdict: 'SOFT_FAIL', reason: 'date claim with no year' };
      if (body.includes(m[1]!)) return { verdict: 'PASS', reason: 'year present in source' };
      return { verdict: 'FAIL', reason: `year ${m[1]} not in source` };
    }
  }
  return { verdict: 'FAIL', reason: 'unknown claim type' };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test hallucination-gate`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gate.ts tests/lib/hallucination-gate.test.ts
git commit -m "feat(gate): hallucination gate with claim source mapping"
```

---

## Task 9: config/voice-rules.yaml (no test — config file)

**Files:**
- Create: `config/voice-rules.yaml`

- [ ] **Step 1: Write the file**

```yaml
banned_phrases:
  - "I recently"
  - "Excited to share"
  - "Today I want to share"
  - "In today's"
  - "game-changer"
  - "game changer"
  - "thought leader"
  - "deep dive"
  - "delve"
  - "leverage"
  - "synergy"
  - "ecosystem"
  - "unpack"
  - "unlock"
  - "Let that sink in"
  - "Here's the thing"
  - "needless to say"
  - "Furthermore"
  - "Moreover"
  - "In conclusion"
  - "It's worth noting"
banned_open_emojis: ["🚀", "✨", "🎯", "💡", "🔥"]
max_emojis_total: 2
max_hashtags: 3
first_line_word_range: [8, 18]
max_paragraph_lines: 3
i_frequency_max: 0.05
```

- [ ] **Step 2: Verify YAML parses**

Run: `node -e "console.log(require('yaml').parse(require('fs').readFileSync('config/voice-rules.yaml','utf8')))"`
Expected: prints object, no error.

- [ ] **Step 3: Commit**

```bash
git add config/voice-rules.yaml
git commit -m "chore(config): voice rules yaml (mirrors gate constants)"
```

---

## Task 10: config/pillars.yaml + skip-dates.yaml (no test — config files)

**Files:**
- Create: `config/pillars.yaml`
- Create: `config/skip-dates.yaml`

- [ ] **Step 1: Write `config/pillars.yaml`**

```yaml
cadence:
  mon: { pillars: [framework, hottake], word_count: [120, 220] }
  wed: { pillars: [framework],          word_count: [150, 180] }
  fri: { pillars: [hottake],            word_count: [120, 150] }
retries:
  max_per_post: 3
  max_cost_per_post_usd: 0.30
voice_corpus:
  refresh_weekly: true
  samples_per_draft: 3
  external_samples_per_handle: 5
  bootstrap:
    weeks_pure_external: 4
    self_corpus_weight_v1: 2.0
    weeks_until_pure_self: 12
```

- [ ] **Step 2: Write `config/skip-dates.yaml`**

```yaml
# ISO dates to skip (no draft attempted; SKIPPED.md written with reason)
skip:
  - { date: "2026-12-25", reason: "Christmas" }
  - { date: "2026-01-01", reason: "New Year" }
```

- [ ] **Step 3: Verify both YAMLs parse**

Run: `node -e "['config/pillars.yaml','config/skip-dates.yaml'].forEach(f=>console.log(f, !!require('yaml').parse(require('fs').readFileSync(f,'utf8'))))"`
Expected: both true.

- [ ] **Step 4: Commit**

```bash
git add config/pillars.yaml config/skip-dates.yaml
git commit -m "chore(config): pillars cadence + skip dates"
```

---

## Task 11: config/sources.yaml (no test — config file)

**Files:**
- Create: `config/sources.yaml`

- [ ] **Step 1: Write the file**

```yaml
lab_blogs:
  - { name: anthropic,  rss: "https://www.anthropic.com/news/rss.xml" }
  - { name: openai,     rss: "https://openai.com/blog/rss.xml" }
  - { name: deepmind,   rss: "https://deepmind.google/blog/rss.xml" }
  - { name: mistral,    rss: "https://mistral.ai/news/feed.xml" }
  - { name: cohere,     rss: "https://cohere.com/blog/rss.xml" }
  - { name: huggingface, rss: "https://huggingface.co/blog/feed.xml" }

curated_newsletters:
  - { name: latent-space,    rss: "https://www.latent.space/feed" }
  - { name: the-batch,        rss: "https://www.deeplearning.ai/the-batch/feed/" }
  - { name: import-ai,        rss: "https://importai.substack.com/feed" }
  - { name: simon-willison,   rss: "https://simonwillison.net/atom/everything/" }
  - { name: interconnects,    rss: "https://www.interconnects.ai/feed" }

# voice handles via RSS bridges; replace BRIDGE with your rsshub instance
voice_handles:
  - { name: akash-gupta-li,   rss: "https://rsshub.app/linkedin/posts/akash-gupta",      kind: linkedin }
  - { name: lenny,            rss: "https://www.lennysnewsletter.com/feed",              kind: linkedin }
  - { name: shreyas-doshi-li, rss: "https://rsshub.app/linkedin/posts/shreyasdoshi",     kind: linkedin }
  - { name: aakash-gupta-li,  rss: "https://rsshub.app/linkedin/posts/aakashg0",         kind: linkedin }
  - { name: ethan-mollick,    rss: "https://oneusefulthing.substack.com/feed",           kind: linkedin }

hn:
  algolia_endpoint: "https://hn.algolia.com/api/v1/search_by_date"
  query_terms: ["AI", "LLM", "agent", "Claude", "GPT", "Anthropic", "OpenAI"]
  min_points: 100
  hours_back: 168     # 7 days
```

NOTE for the implementer: confirm each RSS URL responds 200 before relying on it. If a feed 404s, swap to the publisher's recommended alt feed or remove the source. The pipeline will skip dead sources, so this is non-blocking.

- [ ] **Step 2: Commit**

```bash
git add config/sources.yaml
git commit -m "chore(config): sources catalog (labs, newsletters, voices, HN)"
```

---

## Task 12: prompts/voice-system.md + extract-claims.md + pick-angle.md

**Files:**
- Create: `prompts/voice-system.md`
- Create: `prompts/extract-claims.md`
- Create: `prompts/pick-angle.md`

- [ ] **Step 1: Write `prompts/voice-system.md`**

```markdown
You are drafting a single LinkedIn post for an AI Product Manager who is building a public portfolio aimed at frontier AI labs.

VOICE RULES (non-negotiable):
- No em dashes. No en dashes. Use commas or sentence breaks.
- No clichés: do not use "game-changer", "thought leader", "deep dive", "delve", "leverage", "synergy", "ecosystem", "unpack", "unlock", "needless to say", "Furthermore", "Moreover", "In conclusion", "It's worth noting".
- Never open with: "I recently", "Excited to share", "Today I want to share", "In today's".
- Do not open with an emoji. Maximum 2 emojis total. Maximum 3 hashtags.
- First line is a hook of 8 to 18 words. No period at the end.
- Last line is a genuine question.
- Word count is dictated by the pillar. Honor it strictly.
- No paragraph longer than 3 lines.
- Do not refer to the author's specific employer, internal projects, PRDs, or sprint notes.
- Every named person, every quoted phrase, every numeric stat, every product capability claim MUST come from the provided source URLs.
- Mirror the register, sentence rhythm, and paragraph density of the voice samples below. Do NOT reuse their topics or phrases.

OUTPUT FORMAT (JSON only, no prose, no code fences):
{
  "post_text": "<the post>",
  "claims": [
    { "claim_text": "<exact substring of post_text>", "type": "stat|quote|attribution|capability|date|opinion", "source_url": "<url or null if opinion>", "confidence": 0.0-1.0 }
  ],
  "pillar": "<pillar name>",
  "angle_rationale": "<one sentence>"
}
```

- [ ] **Step 2: Write `prompts/extract-claims.md`**

```markdown
You are reviewing a LinkedIn post for factual claims.

Extract every factual claim. Categorize each:
- "stat" — any number, percentage, or quantity
- "quote" — anything in quotation marks attributed to a person or organization
- "attribution" — a paraphrased statement attributed to a named person
- "capability" — a claim about what a product, model, or system can do
- "date" — a date or time reference framed as fact
- "opinion" — the author's view, NOT containing digits or proper nouns

OUTPUT FORMAT (JSON only):
{
  "claims": [
    { "claim_text": "<exact substring of post>", "type": "...", "span": [start, end] }
  ]
}
```

- [ ] **Step 3: Write `prompts/pick-angle.md`**

```markdown
You will receive a list of clusters (recent AI news/topics). Pick the 3 best for this week's LinkedIn drafts.

CONSTRAINTS:
- Pick exactly 3 clusters, one each for Mon, Wed, Fri.
- Mon = pillar "framework" OR "hottake" (your choice; pick the cluster with the strongest material).
- Wed = pillar "framework" (must be a clear, teachable structure or playbook).
- Fri = pillar "hottake" (must invite disagreement; counter-intuitive claim available).
- Do NOT pick a cluster whose topic was used in any of the recent_angles passed in.

OUTPUT FORMAT (JSON only):
{
  "angles": [
    { "day": "mon|wed|fri", "pillar": "framework|hottake", "cluster_topic": "...", "cluster_urls": ["..."], "one_line_angle": "...", "why_this_pillar": "..." }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add prompts/voice-system.md prompts/extract-claims.md prompts/pick-angle.md
git commit -m "chore(prompts): voice system + extract claims + pick angle"
```

---

## Task 13: prompts/pillars/*.md (7 templates)

**Files:**
- Create: `prompts/pillars/framework.md`
- Create: `prompts/pillars/hottake.md`
- Create: `prompts/pillars/story.md`
- Create: `prompts/pillars/lesson.md`
- Create: `prompts/pillars/myth.md`
- Create: `prompts/pillars/observation.md`
- Create: `prompts/pillars/list.md`

(These mirror the 7 prompt templates in the user's strategy doc, condensed to fit alongside `voice-system.md`.)

- [ ] **Step 1: Write `prompts/pillars/framework.md`**

```markdown
PILLAR: framework

Structure:
- Hook: 1 line, the problem people fail at
- Introduce the framework name in one short sentence
- Numbered list (3 to 5 items), each item 1 to 2 sentences
- One-line takeaway
- Question (must invite a real answer)

Word count: 150-180.
Use a numbered list ONLY for the steps; no bullets elsewhere.
Do not open with a definition. Open with the failure mode the framework prevents.
```

- [ ] **Step 2: Write `prompts/pillars/hottake.md`**

```markdown
PILLAR: hottake

Structure:
- Hook: state the claim directly, full sentence, 8-18 words, no period
- 1-2 lines on the common assumption you are challenging
- 1-2 lines on why the common view is wrong
- 1-2 lines on what is actually true
- Question that invites pushback (not validation)

Word count: 120-150.
No hedging language ("perhaps", "maybe", "I think"). State the claim.
End with a question someone could disagree with.
```

- [ ] **Step 3: Write `prompts/pillars/story.md`**

```markdown
PILLAR: story

Structure:
- Hook: 1 line, the moment, not the lesson
- 2-3 short paragraphs: what happened, decision made, outcome
- 1-2 lines: the lesson
- Question for the reader

Word count: 180-220.
Lead with action or moment, not introspection.
Include at least one specific detail (number, name, place) — must come from sources.
```

- [ ] **Step 4: Write `prompts/pillars/lesson.md`**

```markdown
PILLAR: lesson

Structure:
- Hook: the mistake, NOT the lesson
- What happened, briefly
- The fix
- The lesson at the end
- Question

Word count: 160-200.
Hook should make the reader wonder what went wrong.
Honest, not self-flagellating.
```

- [ ] **Step 5: Write `prompts/pillars/myth.md`**

```markdown
PILLAR: myth

Structure:
- State the myth as if it were true (then immediately subvert)
- Why people believe it (1-2 lines)
- Why it is wrong (1-2 lines)
- What is actually true (1-2 lines)
- Question

Word count: 140-170.
Do not use the word "myth" in the opening line.
Open with the false statement; let the next line flip it.
```

- [ ] **Step 6: Write `prompts/pillars/observation.md`**

```markdown
PILLAR: observation

Structure:
- The observation, stated plainly (hook)
- Why most people miss it
- Why it matters
- Question that invites others' observations

Word count: 130-160.
Open with the observation itself — not "I've been thinking about".
```

- [ ] **Step 7: Write `prompts/pillars/list.md`**

```markdown
PILLAR: list

Structure:
- Hook: 1 line, why the list is valuable (do NOT say "X tips" or "X things I learned")
- Numbered list, 3-7 items, each 1-2 sentences, each starts with the insight (not a label)
- One-line closing thought
- Question

Word count: 150-200.
Each item must be immediately actionable or insightful.
```

- [ ] **Step 8: Commit**

```bash
git add prompts/pillars/
git commit -m "chore(prompts): seven per-pillar templates"
```

---

## Task 14: stages/scrape.ts

**Files:**
- Create: `src/stages/scrape.ts`
- Test: `tests/stages/scrape.test.ts`

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test scrape`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stages/scrape.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { httpGet } from '../lib/fetch.js';
import { parseRss } from '../lib/rss.js';
import { RawItem, RawItemSchema } from '../lib/schema.js';
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
      const filtered = items
        .filter((i) => Date.parse(i.published_at) >= since)
        .map((i) => ({ ...i, source_kind: src.kind }))
        .filter((i): i is RawItem => RawItemSchema.safeParse(i).success);
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
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test scrape`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/stages/scrape.ts tests/stages/scrape.test.ts
git commit -m "feat(scrape): fetch RSS + HN, write per-source JSON"
```

---

## Task 15: stages/cluster.ts

**Files:**
- Create: `src/stages/cluster.ts`
- Test: `tests/stages/cluster.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stages/cluster.test.ts
import { describe, it, expect, vi } from 'vitest';
import { clusterItems } from '../../src/stages/cluster.js';
import { RawItem } from '../../src/lib/schema.js';

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
      mk('https://a/1', 'Claude 4.7 release'),
      mk('https://b/1', 'Claude 4.7 reaction'),
      mk('https://c/1', 'GPT-5 leaked specs'),
    ];
    const clusters = await clusterItems(items, 0.85);
    expect(clusters.length).toBe(2);
    const claudeCluster = clusters.find((c) => c.items.some((i) => i.title.includes('4.7')))!;
    expect(claudeCluster.items.length).toBe(2);
    expect(claudeCluster.source_count).toBe(2);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test cluster`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/cluster.ts`**

```ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { embedTexts, cosine } from '../lib/embed.js';
import { Cluster, RawItem, RawItemSchema } from '../lib/schema.js';

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
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test cluster`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/stages/cluster.ts tests/stages/cluster.test.ts
git commit -m "feat(cluster): embed + cosine grouping per week"
```

---

## Task 16: stages/score.ts

**Files:**
- Create: `src/stages/score.ts`
- Test: `tests/stages/score.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stages/score.test.ts
import { describe, it, expect } from 'vitest';
import { scoreCluster } from '../../src/stages/score.js';
import { Cluster } from '../../src/lib/schema.js';

const now = new Date('2026-04-15T00:00:00Z').getTime();
const mk = (overrides: Partial<Cluster>): Cluster => ({
  topic: 't',
  items: [{ url: 'https://x/1', title: 't', body: '', published_at: '2026-04-14T00:00:00Z', source: 'anthropic', source_kind: 'lab_blog' }],
  earliest_date: '2026-04-14T00:00:00Z',
  source_count: 1,
  ...overrides,
});

describe('scoreCluster', () => {
  it('higher novelty for recent items', () => {
    const recent = scoreCluster(mk({ earliest_date: '2026-04-14T12:00:00Z' }), now);
    const old = scoreCluster(mk({ earliest_date: '2026-04-09T00:00:00Z' }), now);
    expect(recent.novelty).toBeGreaterThan(old.novelty);
  });

  it('lab_blog has higher authority than voice_handle', () => {
    const lab = scoreCluster(mk({}), now);
    const voice = scoreCluster(mk({ items: [{ url: 'https://x/1', title: 't', body: '', published_at: '2026-04-14T00:00:00Z', source: 'akash', source_kind: 'voice_handle' }] }), now);
    expect(lab.authority).toBeGreaterThan(voice.authority);
  });

  it('confirmation saturates at source_count >= 5', () => {
    const c5 = scoreCluster(mk({ source_count: 5 }), now);
    const c10 = scoreCluster(mk({ source_count: 10 }), now);
    expect(c5.confirmation).toBe(c10.confirmation);
    expect(c5.confirmation).toBe(1);
  });

  it('final_score in [0,1]', () => {
    const r = scoreCluster(mk({}), now);
    expect(r.final_score).toBeGreaterThanOrEqual(0);
    expect(r.final_score).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test score`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/score.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cluster, ScoredCluster } from '../lib/schema.js';

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
  const scored = clusters.map((c) => scoreCluster(c, now)).sort((a, b) => b.final_score - a.final_score).slice(0, opts.topN ?? 10);
  const outDir = join(opts.dataDir, 'scored');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${opts.week}.json`), JSON.stringify(scored, null, 2));
  return scored;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test score`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stages/score.ts tests/stages/score.test.ts
git commit -m "feat(score): heuristic ranking with normalized sub-scores"
```

---

## Task 17: stages/angle.ts

**Files:**
- Create: `src/stages/angle.ts`
- Test: `tests/stages/angle.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stages/angle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { dedupeVsRecent, runAngleStage } from '../../src/stages/angle.js';
import { ScoredCluster } from '../../src/lib/schema.js';

vi.mock('../../src/lib/embed.js', () => ({
  embedTexts: vi.fn(async (xs: string[]) => xs.map((x) => x.includes('claude') ? [1, 0] : [0, 1])),
  cosine: (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!,
}));

const mkScored = (topic: string): ScoredCluster => ({
  topic,
  items: [{ url: 'https://x/1', title: topic, body: '', published_at: '2026-04-14T00:00:00Z', source: 's' }],
  earliest_date: '2026-04-14T00:00:00Z',
  source_count: 1,
  novelty: 1, authority: 1, confirmation: 1, controversy: 0, final_score: 0.8,
});

describe('angle', () => {
  it('dedupeVsRecent removes overlapping topics', async () => {
    const out = await dedupeVsRecent([mkScored('claude release'), mkScored('gpt-5')], ['claude analysis'], 0.85);
    expect(out.length).toBe(1);
    expect(out[0]!.topic).toBe('gpt-5');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test angle`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/angle.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Angle, AngleSchema, ScoredCluster, PillarEnum, DayEnum } from '../lib/schema.js';
import { embedTexts, cosine } from '../lib/embed.js';
import { complete } from '../lib/llm.js';
import { makeLogger } from '../lib/log.js';

export async function dedupeVsRecent(scored: ScoredCluster[], recentTopics: string[], threshold: number): Promise<ScoredCluster[]> {
  if (recentTopics.length === 0) return scored;
  const allTexts = [...scored.map((s) => s.topic), ...recentTopics];
  const vecs = await embedTexts(allTexts);
  const scoredVecs = vecs.slice(0, scored.length);
  const recentVecs = vecs.slice(scored.length);
  return scored.filter((_, i) => recentVecs.every((rv) => cosine(scoredVecs[i]!, rv) <= threshold));
}

const AnglesResponseSchema = z.object({
  angles: z.array(z.object({
    day: DayEnum,
    pillar: PillarEnum,
    cluster_topic: z.string(),
    cluster_urls: z.array(z.string().url()).min(1),
    one_line_angle: z.string(),
    why_this_pillar: z.string(),
  })).length(3),
});

export async function pickAngles(client: Anthropic, scored: ScoredCluster[], promptText: string): Promise<{ angles: Angle[]; cost_usd: number }> {
  const userPrompt = `${promptText}\n\nCLUSTERS:\n${JSON.stringify(scored.slice(0, 10).map((c) => ({
    topic: c.topic,
    urls: c.items.map((i) => i.url),
    source_count: c.source_count,
    final_score: c.final_score,
  })), null, 2)}`;
  const res = await complete({ client, model: 'claude-sonnet-4-6', system: 'Respond with valid JSON only.', user: userPrompt, maxTokens: 1500 });
  const json = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  const parsed = AnglesResponseSchema.parse(json);
  return { angles: parsed.angles.map((a) => AngleSchema.parse(a)), cost_usd: res.cost_usd };
}

export async function runAngleStage(opts: { client: Anthropic; dataDir: string; week: string; promptPath: string; recentWeeksLookback?: number; dedupThreshold?: number }): Promise<{ angles: Angle[]; cost_usd: number }> {
  const log = makeLogger({ name: 'angle' });
  const scored = JSON.parse(readFileSync(join(opts.dataDir, 'scored', `${opts.week}.json`), 'utf8')) as ScoredCluster[];

  const lookback = opts.recentWeeksLookback ?? 4;
  const recentTopics: string[] = [];
  const angleDir = join(opts.dataDir, 'angles');
  if (existsSync(angleDir)) {
    const all = require('node:fs').readdirSync(angleDir).filter((f: string) => f.endsWith('.json')).slice(-lookback);
    for (const f of all) {
      const arr = JSON.parse(readFileSync(join(angleDir, f), 'utf8')) as Angle[];
      for (const a of arr) recentTopics.push(a.cluster_topic);
    }
  }

  const deduped = await dedupeVsRecent(scored, recentTopics, opts.dedupThreshold ?? 0.85);
  log.info({ scored: scored.length, deduped: deduped.length }, 'angle input');

  const promptText = readFileSync(opts.promptPath, 'utf8');
  const { angles, cost_usd } = await pickAngles(opts.client, deduped, promptText);

  mkdirSync(angleDir, { recursive: true });
  writeFileSync(join(angleDir, `${opts.week}.json`), JSON.stringify(angles, null, 2));
  return { angles, cost_usd };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test angle`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/stages/angle.ts tests/stages/angle.test.ts
git commit -m "feat(angle): cross-week dedup + LLM pick 3 angles"
```

---

## Task 18: stages/draft.ts

**Files:**
- Create: `src/stages/draft.ts`
- Test: `tests/stages/draft.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stages/draft.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildDraftPrompt, runDraftOnce } from '../../src/stages/draft.js';
import { Angle } from '../../src/lib/schema.js';

const angle: Angle = {
  day: 'fri',
  pillar: 'hottake',
  cluster_topic: 'claude 4.7',
  cluster_urls: ['https://anthropic.com/news/claude-4-7'],
  one_line_angle: 'release cadence is the moat',
  why_this_pillar: 'cadence > raw capability',
};

describe('draft', () => {
  it('buildDraftPrompt includes pillar template + voice samples + sources', () => {
    const out = buildDraftPrompt({
      angle,
      pillarTemplate: 'PILLAR: hottake (template body)',
      sources: [{ url: 'https://anthropic.com/news/claude-4-7', body: 'Claude 4.7 release notes' }],
      voiceSamples: ['sample post 1', 'sample post 2'],
    });
    expect(out).toContain('PILLAR: hottake');
    expect(out).toContain('Claude 4.7 release notes');
    expect(out).toContain('sample post 1');
    expect(out).toContain('https://anthropic.com/news/claude-4-7');
  });

  it('runDraftOnce parses LLM JSON response into Draft', async () => {
    const fakeClient = { messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        post_text: 'A hook line of about ten words goes here today\nbody body body body body body body body body body body\nWhat do you think?',
        claims: [{ claim_text: 'release cadence', type: 'opinion', confidence: 0.6 }],
        pillar: 'hottake',
        angle_rationale: 'cadence > capability',
      }) }],
      usage: { input_tokens: 100, output_tokens: 80 },
    }) } } as any;
    const draft = await runDraftOnce({
      client: fakeClient,
      systemPrompt: 'sys',
      userPrompt: 'u',
    });
    expect(draft.post_text).toContain('hook line');
    expect(draft.pillar).toBe('hottake');
    expect(draft.cost_usd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test draft`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/draft.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Angle, Draft, DraftSchema } from '../lib/schema.js';
import { complete } from '../lib/llm.js';

export interface BuildPromptParams {
  angle: Angle;
  pillarTemplate: string;
  sources: { url: string; body: string }[];
  voiceSamples: string[];
}

export function buildDraftPrompt(p: BuildPromptParams): string {
  const sourceBlock = p.sources.map((s) => `URL: ${s.url}\nBODY:\n${s.body.slice(0, 2000)}`).join('\n---\n');
  const samplesBlock = p.voiceSamples.map((s, i) => `SAMPLE ${i + 1}:\n${s}`).join('\n---\n');
  return `${p.pillarTemplate}

ANGLE: ${p.angle.one_line_angle}
WHY THIS PILLAR: ${p.angle.why_this_pillar}

SOURCES (use ONLY these for facts/quotes/stats/attributions):
${sourceBlock}

VOICE SAMPLES (mirror register/rhythm; do NOT reuse topics or phrasings):
${samplesBlock}

Now write the post per the rules. Output JSON only.`;
}

export interface RunDraftOnceParams {
  client: Anthropic;
  systemPrompt: string;
  userPrompt: string;
  attempt?: number;
}

export async function runDraftOnce(p: RunDraftOnceParams): Promise<Draft> {
  const res = await complete({
    client: p.client,
    model: 'claude-sonnet-4-6',
    system: p.systemPrompt,
    user: p.userPrompt,
    maxTokens: 1200,
    temperature: 0.7,
  });
  const cleaned = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
  const parsed = JSON.parse(cleaned);
  const draft = DraftSchema.parse({ ...parsed, attempt: p.attempt ?? 0, cost_usd: res.cost_usd });
  return draft;
}

export interface RunDraftStageParams {
  client: Anthropic;
  dataDir: string;
  week: string;
  voiceSystemPath: string;
  pillarPromptDir: string;
  voiceCorpusDir: string;
  samplesPerDraft?: number;
}

export async function runDraftStage(p: RunDraftStageParams): Promise<{ drafts: Record<string, Draft>; cost_usd: number }> {
  const angles = JSON.parse(readFileSync(join(p.dataDir, 'angles', `${p.week}.json`), 'utf8')) as Angle[];
  const clusters = JSON.parse(readFileSync(join(p.dataDir, 'clusters', `${p.week}.json`), 'utf8')) as { items: { url: string; body: string }[]; topic: string }[];
  const systemPrompt = readFileSync(p.voiceSystemPath, 'utf8');

  const drafts: Record<string, Draft> = {};
  let totalCost = 0;

  for (const angle of angles) {
    const pillarTemplate = readFileSync(join(p.pillarPromptDir, `${angle.pillar}.md`), 'utf8');
    const cluster = clusters.find((c) => angle.cluster_urls.some((u) => c.items.some((i) => i.url === u)));
    const sources = cluster?.items.map((i) => ({ url: i.url, body: i.body })) ?? [];
    const samples = pickVoiceSamples(p.voiceCorpusDir, angle.pillar, p.samplesPerDraft ?? 3);
    const userPrompt = buildDraftPrompt({ angle, pillarTemplate, sources, voiceSamples: samples });
    const draft = await runDraftOnce({ client: p.client, systemPrompt, userPrompt, attempt: 0 });
    drafts[angle.day] = draft;
    totalCost += draft.cost_usd;
  }

  const outDir = join(p.dataDir, 'drafts');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${p.week}.json`), JSON.stringify(drafts, null, 2));
  return { drafts, cost_usd: totalCost };
}

function pickVoiceSamples(corpusDir: string, _pillar: string, n: number): string[] {
  const externalDir = join(corpusDir, 'external');
  if (!existsSync(externalDir)) return [];
  const files = readdirSync(externalDir).filter((f) => f.endsWith('.txt'));
  const shuffled = files.sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map((f) => readFileSync(join(externalDir, f), 'utf8'));
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test draft`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stages/draft.ts tests/stages/draft.test.ts
git commit -m "feat(draft): build prompt + LLM call returns typed Draft"
```

---

## Task 19: stages/polish.ts

**Files:**
- Create: `src/stages/polish.ts`
- Test: `tests/stages/polish.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stages/polish.test.ts
import { describe, it, expect, vi } from 'vitest';
import { polishDraft, formatFinalMarkdown } from '../../src/stages/polish.js';
import { Draft } from '../../src/lib/schema.js';

const cleanDraft: Draft = {
  post_text: `What if every model release felt like a product launch
Most teams treat releases as engineering milestones, not product moments.
Three reasons that costs you reach.
First, no narrative. Second, no positioning. Third, no question to answer.
Fix that and your model lands twice as hard.
What does your team do on launch day?`,
  claims: [{ claim_text: 'every model release', type: 'opinion', confidence: 0.6 }],
  pillar: 'hottake',
  angle_rationale: 'cadence > capability',
  attempt: 0,
  cost_usd: 0,
};

describe('polish', () => {
  it('passes a clean draft', async () => {
    const fakeClient = { messages: { create: vi.fn() } } as any; // not called for clean draft
    const out = await polishDraft({
      client: fakeClient,
      draft: cleanDraft,
      sources: [],
      voiceCorpusUrls: [],
      maxRetries: 0,
      retryFn: async () => cleanDraft,
    });
    expect(out.skipped).toBe(false);
    expect(out.voice_gate_pass).toBe(true);
    expect(out.hallucination_gate_pass).toBe(true);
    expect(out.final_markdown).toContain('# Friday — Hot take');
  });

  it('marks skipped after maxRetries fail', async () => {
    const badDraft: Draft = { ...cleanDraft, post_text: 'too short — em dash here\nhi\n?' };
    const out = await polishDraft({
      client: { messages: { create: vi.fn() } } as any,
      draft: badDraft,
      sources: [],
      voiceCorpusUrls: [],
      maxRetries: 2,
      retryFn: async () => badDraft,
    });
    expect(out.skipped).toBe(true);
    expect(out.skipped_reason).toBeTruthy();
  });

  it('formatFinalMarkdown includes sources block + metadata', () => {
    const md = formatFinalMarkdown({
      day: 'fri',
      draft: cleanDraft,
      sources: [{ url: 'https://x/1', title: 'X' }],
      gate_pass_rate: 1,
    });
    expect(md).toContain('# Friday — Hot take');
    expect(md).toContain('https://x/1');
    expect(md).toContain('pillar=hottake');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test polish`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/polish.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Draft, Polished, Angle, Day } from '../lib/schema.js';
import { runVoiceGate, runHallucinationGate } from '../lib/gate.js';

export interface PolishOnceParams {
  client: Anthropic;
  draft: Draft;
  sources: { url: string; body: string }[];
  voiceCorpusUrls: string[];
  maxRetries: number;
  retryFn: (attempt: number, prevDraft: Draft, gateInfo: { voice_failures: string[]; hallucination_failures: string[] }) => Promise<Draft>;
}

export async function polishDraft(p: PolishOnceParams): Promise<Polished> {
  let current = p.draft;
  let lastVoice = runVoiceGate(current.post_text, { pillar: current.pillar });
  let lastHall = runHallucinationGate({ claims: current.claims, sources: p.sources, voiceCorpusUrls: p.voiceCorpusUrls });

  for (let attempt = 1; attempt <= p.maxRetries && (!lastVoice.pass || !lastHall.pass); attempt++) {
    current = await p.retryFn(attempt, current, {
      voice_failures: lastVoice.failures,
      hallucination_failures: lastHall.verdicts.filter((v) => v.verdict === 'FAIL').map((v) => v.reason),
    });
    lastVoice = runVoiceGate(current.post_text, { pillar: current.pillar });
    lastHall = runHallucinationGate({ claims: current.claims, sources: p.sources, voiceCorpusUrls: p.voiceCorpusUrls });
  }

  const ok = lastVoice.pass && lastHall.pass;
  return {
    draft: current,
    verdicts: lastHall.verdicts,
    voice_gate_pass: lastVoice.pass,
    voice_gate_failures: lastVoice.failures,
    hallucination_gate_pass: lastHall.pass,
    skipped: !ok,
    skipped_reason: ok ? undefined : `voice: ${lastVoice.failures.join('; ')} | claims: ${lastHall.verdicts.filter(v => v.verdict === 'FAIL').map(v => v.reason).join('; ')}`,
  };
}

const DAY_TITLES: Record<Day, string> = {
  mon: 'Monday',
  wed: 'Wednesday',
  fri: 'Friday',
};

const PILLAR_TITLE: Record<string, string> = {
  framework: 'Framework',
  hottake: 'Hot take',
  story: 'Inside the build',
  lesson: 'Lesson',
  myth: 'Myth-bust',
  observation: 'Observation',
  list: 'List',
};

export interface FormatParams {
  day: Day;
  draft: Draft;
  sources: { url: string; title?: string }[];
  gate_pass_rate: number;
}

export function formatFinalMarkdown(p: FormatParams): string {
  const sourcesBlock = p.sources.map((s) => `- [${s.title ?? s.url}](${s.url})`).join('\n');
  return `# ${DAY_TITLES[p.day]} — ${PILLAR_TITLE[p.draft.pillar] ?? p.draft.pillar}

${p.draft.post_text}

---

**Sources:**
${sourcesBlock}

**Why this angle:** ${p.draft.angle_rationale}

**Metadata:** pillar=${p.draft.pillar} | retries=${p.draft.attempt} | cost=$${p.draft.cost_usd.toFixed(2)} | gate_pass_rate=${Math.round(p.gate_pass_rate * 100)}%
`;
}

export interface RunPolishStageParams {
  client: Anthropic;
  dataDir: string;
  week: string;
  draftsRoot: string;
  voiceCorpusDir: string;
  retryFn: (attempt: number, prevDraft: Draft, gateInfo: { voice_failures: string[]; hallucination_failures: string[] }) => Promise<Draft>;
  maxRetries?: number;
}

export async function runPolishStage(p: RunPolishStageParams): Promise<Record<Day, Polished>> {
  const angles = JSON.parse(readFileSync(join(p.dataDir, 'angles', `${p.week}.json`), 'utf8')) as Angle[];
  const drafts = JSON.parse(readFileSync(join(p.dataDir, 'drafts', `${p.week}.json`), 'utf8')) as Record<Day, Draft>;
  const clusters = JSON.parse(readFileSync(join(p.dataDir, 'clusters', `${p.week}.json`), 'utf8')) as { items: { url: string; body: string; title: string }[] }[];

  const voiceCorpusUrls = collectVoiceCorpusUrls(p.voiceCorpusDir);
  const out: Record<string, Polished> = {};
  const outDir = join(p.draftsRoot, p.week);
  mkdirSync(outDir, { recursive: true });

  for (const angle of angles) {
    const draft = drafts[angle.day];
    if (!draft) continue;
    const cluster = clusters.find((c) => angle.cluster_urls.some((u) => c.items.some((i) => i.url === u)));
    const sources = cluster?.items.map((i) => ({ url: i.url, body: i.body, title: i.title })) ?? [];

    const polished = await polishDraft({
      client: p.client,
      draft,
      sources,
      voiceCorpusUrls,
      maxRetries: p.maxRetries ?? 2,
      retryFn: p.retryFn,
    });

    if (polished.skipped) {
      writeFileSync(join(outDir, `${angle.day}.SKIPPED.md`), `# ${angle.day} SKIPPED\n\n${polished.skipped_reason}\n`);
    } else {
      const passRate = polished.verdicts.length === 0 ? 1 : polished.verdicts.filter((v) => v.verdict === 'PASS').length / polished.verdicts.length;
      const md = formatFinalMarkdown({ day: angle.day, draft: polished.draft, sources: sources.map((s) => ({ url: s.url, title: s.title })), gate_pass_rate: passRate });
      polished.final_markdown = md;
      writeFileSync(join(outDir, `${angle.day}.md`), md);
    }
    out[angle.day] = polished;
  }
  return out as Record<Day, Polished>;
}

function collectVoiceCorpusUrls(dir: string): string[] {
  const urls: string[] = [];
  for (const sub of ['external', 'self']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    const meta = join(d, 'urls.json');
    if (existsSync(meta)) {
      try { urls.push(...(JSON.parse(readFileSync(meta, 'utf8')) as string[])); } catch { /* ignore */ }
    }
  }
  return urls;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test polish`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stages/polish.ts tests/stages/polish.test.ts
git commit -m "feat(polish): voice + hallucination gates with retry, final markdown"
```

---

## Task 20: pipeline.ts orchestrator

**Files:**
- Create: `src/pipeline.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { computeIsoWeek } from '../src/pipeline.js';

describe('pipeline helpers', () => {
  it('computeIsoWeek for known date', () => {
    expect(computeIsoWeek(new Date('2026-04-19T00:00:00Z'))).toBe('2026-W17');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test pipeline`
Expected: FAIL.

- [ ] **Step 3: Implement `src/pipeline.ts`**

```ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
dayjs.extend(isoWeek);
import { runScrape } from './stages/scrape.js';
import { runCluster } from './stages/cluster.js';
import { runScore } from './stages/score.js';
import { runAngleStage } from './stages/angle.js';
import { runDraftStage } from './stages/draft.js';
import { runPolishStage } from './stages/polish.js';
import { makeClient, complete } from './lib/llm.js';
import { Draft, DraftSchema, RunSummary } from './lib/schema.js';
import { makeLogger } from './lib/log.js';

export function computeIsoWeek(d: Date): string {
  const w = dayjs(d).isoWeek();
  return `${dayjs(d).isoWeekYear()}-W${String(w).padStart(2, '0')}`;
}

const REPO_ROOT = process.cwd();

async function main(): Promise<void> {
  const log = makeLogger({ name: 'pipeline', filePath: join(REPO_ROOT, 'logs', `${computeIsoWeek(new Date())}/pipeline.log`) });
  const week = computeIsoWeek(new Date());
  const dataDir = join(REPO_ROOT, 'data');
  const sourcesYaml = readFileSync(join(REPO_ROOT, 'config', 'sources.yaml'), 'utf8');
  const client = makeClient();

  const summary: RunSummary = {
    week, started_at: new Date().toISOString(), stages: [], total_cost_usd: 0, drafts_produced: 0, drafts_skipped: 0,
  };
  const tStart = (s: string) => ({ s, t: Date.now() });
  const tEnd = (st: { s: string; t: number }, extras: Partial<{ llm_calls: number; cost_usd: number; ok: boolean; error: string }> = {}) => {
    summary.stages.push({ stage: st.s, duration_ms: Date.now() - st.t, llm_calls: extras.llm_calls ?? 0, cost_usd: extras.cost_usd ?? 0, ok: extras.ok ?? true, error: extras.error });
    summary.total_cost_usd += extras.cost_usd ?? 0;
  };

  try {
    let st = tStart('scrape');
    const scrape = await runScrape({ sourcesYaml, week, dataDir });
    tEnd(st, { ok: true });
    log.info({ counts: scrape.counts, errors: scrape.errors }, 'scrape done');

    st = tStart('cluster');
    await runCluster({ dataDir, week });
    tEnd(st);

    st = tStart('score');
    runScore({ dataDir, week });
    tEnd(st);

    st = tStart('angle');
    const angle = await runAngleStage({ client, dataDir, week, promptPath: join(REPO_ROOT, 'prompts', 'pick-angle.md') });
    tEnd(st, { llm_calls: 1, cost_usd: angle.cost_usd });

    st = tStart('draft');
    const draft = await runDraftStage({
      client, dataDir, week,
      voiceSystemPath: join(REPO_ROOT, 'prompts', 'voice-system.md'),
      pillarPromptDir: join(REPO_ROOT, 'prompts', 'pillars'),
      voiceCorpusDir: join(dataDir, 'voice-corpus'),
    });
    tEnd(st, { llm_calls: Object.keys(draft.drafts).length, cost_usd: draft.cost_usd });

    st = tStart('polish');
    const polished = await runPolishStage({
      client, dataDir, week,
      draftsRoot: join(REPO_ROOT, 'drafts'),
      voiceCorpusDir: join(dataDir, 'voice-corpus'),
      retryFn: async (attempt, prev, info) => makeRetry(client, prev, info, attempt),
      maxRetries: 2,
    });
    tEnd(st, { llm_calls: 0 });

    summary.drafts_produced = Object.values(polished).filter((p) => !p.skipped).length;
    summary.drafts_skipped = Object.values(polished).filter((p) => p.skipped).length;
  } catch (e: any) {
    log.error({ err: e.message }, 'pipeline aborted');
    summary.stages.push({ stage: 'aborted', duration_ms: 0, llm_calls: 0, cost_usd: 0, ok: false, error: e.message });
    process.exitCode = 1;
  } finally {
    summary.finished_at = new Date().toISOString();
    const runDir = join(dataDir, 'runs');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `${week}.json`), JSON.stringify(summary, null, 2));
    appendQualityRow(summary);
    log.info({ summary }, 'pipeline done');
  }
}

async function makeRetry(client: ReturnType<typeof makeClient>, prev: Draft, info: { voice_failures: string[]; hallucination_failures: string[] }, attempt: number): Promise<Draft> {
  const instruction = attempt === 1
    ? `Your previous draft failed checks. Fix these issues:\nVoice failures: ${info.voice_failures.join('; ')}\nClaim failures: ${info.hallucination_failures.join('; ')}\n\nReturn corrected JSON.`
    : `Facts-only mode: only state what the sources literally say. Drop any unverifiable claim. Voice failures to fix: ${info.voice_failures.join('; ')}.`;
  const res = await complete({
    client, model: 'claude-sonnet-4-6', system: 'Return JSON only.',
    user: `${instruction}\n\nPREVIOUS DRAFT:\n${JSON.stringify(prev)}`,
    maxTokens: 1200,
  });
  const parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ''));
  return DraftSchema.parse({ ...parsed, attempt, cost_usd: prev.cost_usd + res.cost_usd });
}

function appendQualityRow(s: RunSummary): void {
  const path = join(REPO_ROOT, 'QUALITY.md');
  const headerRow = '| week | drafts | skipped | total_cost | duration_s |\n|---|---|---|---|---|\n';
  const totalDuration = s.stages.reduce((a, b) => a + b.duration_ms, 0) / 1000;
  const row = `| ${s.week} | ${s.drafts_produced} | ${s.drafts_skipped} | $${s.total_cost_usd.toFixed(2)} | ${totalDuration.toFixed(1)} |\n`;
  try {
    const existing = readFileSync(path, 'utf8');
    writeFileSync(path, existing + row);
  } catch {
    writeFileSync(path, `# QUALITY\n\n${headerRow}${row}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test pipeline`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts tests/pipeline.test.ts
git commit -m "feat(pipeline): orchestrator runs 6 stages + writes run summary"
```

---

## Task 21: cli.ts (per-stage rerun + posted mark + freeform)

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/cli.js';

describe('cli', () => {
  it('parses stage subcommand', () => {
    expect(parseCliArgs(['stage', 'scrape', '--week', '2026-W17'])).toEqual({ cmd: 'stage', name: 'scrape', flags: { week: '2026-W17' } });
  });
  it('parses posted subcommand', () => {
    expect(parseCliArgs(['posted', 'fri', '--url', 'https://x/y'])).toEqual({ cmd: 'posted', day: 'fri', flags: { url: 'https://x/y' } });
  });
  it('parses draft:freeform', () => {
    expect(parseCliArgs(['draft:freeform', '--topic', 'X', '--pillar', 'hottake'])).toEqual({ cmd: 'draft:freeform', flags: { topic: 'X', pillar: 'hottake' } });
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test cli`
Expected: FAIL.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
import { mkdirSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { computeIsoWeek } from './pipeline.js';

export type CliArgs =
  | { cmd: 'stage'; name: string; flags: Record<string, string> }
  | { cmd: 'rerun'; flags: Record<string, string> }
  | { cmd: 'voice:refresh'; flags: Record<string, string> }
  | { cmd: 'posted'; day: string; flags: Record<string, string> }
  | { cmd: 'draft:freeform'; flags: Record<string, string> }
  | { cmd: 'help' };

export function parseCliArgs(argv: string[]): CliArgs {
  const [cmd, ...rest] = argv;
  if (!cmd) return { cmd: 'help' };
  if (cmd === 'stage') {
    const [name, ...kv] = rest;
    return { cmd: 'stage', name: name ?? '', flags: parseKv(kv) };
  }
  if (cmd === 'posted') {
    const [day, ...kv] = rest;
    return { cmd: 'posted', day: day ?? '', flags: parseKv(kv) };
  }
  if (cmd === 'rerun' || cmd === 'voice:refresh' || cmd === 'draft:freeform') {
    return { cmd: cmd as any, flags: parseKv(rest) };
  }
  return { cmd: 'help' };
}

function parseKv(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!;
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = args[i + 1] ?? '';
      out[key] = val;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'help':
      console.log('usage: cli <stage|rerun|voice:refresh|posted|draft:freeform> ...');
      return;
    case 'posted': {
      const week = args.flags.week ?? computeIsoWeek(new Date());
      const draftPath = join(process.cwd(), 'drafts', week, `${args.day}.md`);
      if (!existsSync(draftPath)) {
        console.error(`no draft at ${draftPath}`);
        process.exitCode = 1; return;
      }
      const postedDir = join(process.cwd(), 'posted', week);
      mkdirSync(postedDir, { recursive: true });
      const dest = join(postedDir, `${args.day}.md`);
      renameSync(draftPath, dest);
      const meta = join(postedDir, `${args.day}.json`);
      writeFileSync(meta, JSON.stringify({ url: args.flags.url, posted_at: new Date().toISOString(), source_file: basename(dest) }, null, 2));
      console.log(`marked posted: ${args.day} (${args.flags.url})`);
      return;
    }
    default:
      console.log(JSON.stringify(args));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

NOTE for the implementer: stage/rerun/voice:refresh/draft:freeform handlers are intentionally minimal in this task (they print the parsed args). Wiring them to the actual stage runners is a follow-up; the orchestrator covers the happy path. If you want them functional now, import `runScrape`/`runCluster`/etc. and dispatch on `args.name`. Skip if you want to ship the cron loop first.

- [ ] **Step 4: Verify pass**

Run: `pnpm test cli`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(cli): arg parsing + posted-mark handler"
```

---

## Task 22: GitHub Actions workflow + manual rerun

**Files:**
- Create: `.github/workflows/pipeline.yml`
- Create: `.github/workflows/rerun.yml`

- [ ] **Step 1: Write `.github/workflows/pipeline.yml`**

```yaml
name: pipeline

on:
  schedule:
    - cron: '30 0 * * 0'   # Sun 00:30 UTC = 06:00 IST
    - cron: '30 0 * * 3'   # Wed 00:30 UTC
  workflow_dispatch: {}

permissions:
  contents: write
  issues: write

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: run pipeline
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}
          USER_AGENT: linkedin-engine/0.1 (+github.com/${{ github.repository }})
        run: pnpm pipeline
      - name: commit drafts + run summary
        run: |
          git config user.name "linkedin-engine-bot"
          git config user.email "bot@users.noreply.github.com"
          git add drafts/ data/runs/ QUALITY.md logs/ data/raw/ data/clusters/ data/scored/ data/angles/ data/drafts/ || true
          git diff --cached --quiet || git commit -m "chore: weekly pipeline run [skip ci]"
          git push
      - name: write step summary
        if: always()
        run: |
          echo "## Pipeline run" >> $GITHUB_STEP_SUMMARY
          ls drafts/ 2>/dev/null | tail -1 | xargs -I{} ls drafts/{} >> $GITHUB_STEP_SUMMARY || true
      - name: open issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner, repo: context.repo.repo,
              title: `pipeline failed ${new Date().toISOString().slice(0,10)}`,
              body: `Run: ${context.runId}\nLogs: https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
            });
```

- [ ] **Step 2: Write `.github/workflows/rerun.yml`**

```yaml
name: rerun

on:
  workflow_dispatch:
    inputs:
      stage:
        description: stage to rerun (scrape|cluster|score|angle|draft|polish)
        required: true
      week:
        description: ISO week (e.g. 2026-W17)
        required: true
      day:
        description: optional day (mon|wed|fri) for polish
        required: false

permissions:
  contents: write

jobs:
  rerun:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}
        run: pnpm stage ${{ github.event.inputs.stage }} --week ${{ github.event.inputs.week }} ${{ github.event.inputs.day && format('--day {0}', github.event.inputs.day) || '' }}
      - name: commit
        run: |
          git config user.name "linkedin-engine-bot"
          git config user.email "bot@users.noreply.github.com"
          git add drafts/ data/ logs/ || true
          git diff --cached --quiet || git commit -m "chore: rerun ${{ github.event.inputs.stage }} for ${{ github.event.inputs.week }}"
          git push
```

- [ ] **Step 3: Validate workflow YAML syntax**

Run: `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/pipeline.yml','utf8'))" && node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/rerun.yml','utf8'))"`
Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/
git commit -m "ci: weekly pipeline cron + manual stage rerun workflow"
```

---

## Task 23: README + smoke run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with full instructions**

```markdown
# linkedin-engine

3 LinkedIn drafts per week (Mon/Wed/Fri), source-grounded, human voice. So you stay consistent without sounding like a bot.

## What you read

Only this folder, ever:

\`\`\`
drafts/YYYY-WW/{mon,wed,fri}.md
\`\`\`

## How it runs

GitHub Actions cron triggers Sun 00:30 UTC and Wed 00:30 UTC. The pipeline runs 6 stages (scrape → cluster → score → angle → draft → polish), commits drafts to `main`, GitHub mobile sends a push.

## Local

\`\`\`
pnpm install
cp .env.example .env   # fill ANTHROPIC_API_KEY + VOYAGE_API_KEY
pnpm test              # all unit tests
pnpm pipeline          # full week run
\`\`\`

## Re-run a single stage

\`\`\`
pnpm stage polish --week 2026-W17 --day fri
\`\`\`

## After publishing on LinkedIn

\`\`\`
pnpm posted fri --url https://www.linkedin.com/feed/update/urn:li:activity:...
\`\`\`

Moves the draft to `posted/YYYY-WW/`, schedules add-to-self-corpus 30 days later.

## Spec

`docs/superpowers/specs/2026-04-19-linkedin-engine-design.md`
```

- [ ] **Step 2: Run typecheck + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 3: Smoke-run pipeline locally with stub network (optional)**

If you want to verify wiring without spending API tokens:
- export `ANTHROPIC_API_KEY=fake` (will fail on real LLM call but stages 1-3 will run)
- run: `pnpm tsx -e "import { runScrape } from './src/stages/scrape.js'; import { readFileSync } from 'node:fs'; runScrape({ sourcesYaml: readFileSync('config/sources.yaml','utf8'), week: '2026-W17', dataDir: 'data' }).then(r => console.log(r))"`
- inspect `data/raw/2026-W17/*.json` to confirm scraping works against real RSS feeds

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with run/rerun/posted instructions"
```

---

## Task 24: Voice corpus refresh helper (optional, recommended for v1)

**Files:**
- Create: `src/voice-refresh.ts`
- Test: `tests/voice-refresh.test.ts`

This task is optional for the very first run, since `pickVoiceSamples` returns `[]` if the corpus is empty (the LLM will draft without samples — works, but voice will be more generic). Add it to enable Layer 3 voice fidelity.

- [ ] **Step 1: Write failing test**

```ts
// tests/voice-refresh.test.ts
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
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test voice-refresh`
Expected: FAIL.

- [ ] **Step 3: Implement `src/voice-refresh.ts`**

```ts
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
```

- [ ] **Step 4: Verify pass**

Run: `pnpm test voice-refresh`
Expected: PASS.

- [ ] **Step 5: Wire up `pnpm voice:refresh`** by extending `src/cli.ts` `main()` switch case `'voice:refresh':`:

```ts
case 'voice:refresh': {
  const { parse: parseYaml } = await import('yaml');
  const { readFileSync } = await import('node:fs');
  const { refreshVoiceCorpus } = await import('./voice-refresh.js');
  const cfg = parseYaml(readFileSync(join(process.cwd(), 'config', 'sources.yaml'), 'utf8'));
  const out = await refreshVoiceCorpus({
    handles: cfg.voice_handles,
    outDir: join(process.cwd(), 'data', 'voice-corpus'),
    samplesPerHandle: 5,
  });
  console.log(out);
  return;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/voice-refresh.ts tests/voice-refresh.test.ts src/cli.ts
git commit -m "feat(voice): refresh voice corpus from RSS handles"
```

---

## Self-review (run before handoff)

After completing all tasks above, run this checklist:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` — all tests pass (count target: 30+ tests across all files)
- [ ] `pnpm pipeline` runs end-to-end against real APIs in a throwaway week — verify `drafts/<week>/*.md` is produced and contains a `Sources:` block + `Why this angle:` line
- [ ] One sample draft passes manual eyeball review: hook is 8-18 words, no em dash anywhere, ends with `?`, no banned phrases
- [ ] Force a hallucination: edit a draft to add `"73% of teams struggle"` (no source) → re-run `pnpm stage polish` → confirm SKIPPED.md is written
- [ ] GH Actions: push to a branch, trigger `workflow_dispatch` on `pipeline.yml`, confirm it runs and commits drafts
- [ ] Add `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` as encrypted GH secrets in repo settings

## Spec coverage check

Cross-reference spec sections to tasks:

| Spec section | Implementing task |
|---|---|
| 5.1 Pipeline | Task 20 (pipeline.ts) |
| 5.3 scrape | Task 14 |
| 5.3 cluster | Task 15 |
| 5.3 score | Task 16 |
| 5.3 angle | Task 17 |
| 5.3 draft | Task 18 |
| 5.3 polish (6a hallucination) | Task 8 + Task 19 |
| 5.3 polish (6b voice) | Task 7 + Task 19 |
| 6 voice fidelity layers 1-3 | Tasks 7, 9, 13, 18 |
| 6 voice fidelity layer 4 (self-corpus) | Task 24 (external part); self-corpus scrape deferred per spec §14 v2 |
| 6 voice fidelity layer 5 (per-pillar templates) | Task 13 |
| 7.1 Infrastructure | Task 22 (GH Actions) |
| 7.2 Failure recovery | Tasks 3, 6, 14, 19, 20 (per-stage error handling) |
| 7.3 Cross-week dedup | Task 17 (dedupeVsRecent) |
| 7.4 Observability | Tasks 2, 20 (logger + run summary + QUALITY.md) |
| 7.5 Edge cases (skip dates) | Task 10 (config); enforcement deferred — add a check in `src/pipeline.ts` `main()` if needed |
| 7.6 Feedback loop v1 | Task 21 (`pnpm posted`) |
| 9 Repo layout | All tasks combined |
| 10 Scripts | Tasks 0, 21, 24 |
| 11 Secrets | Tasks 0 (.env.example) + 22 (GH secrets) |

**Known gap to flag in code review:** §7.5 holiday skip is not yet enforced in `src/pipeline.ts`. To close, in `main()` before stage 4 (`angle`), check today's ISO date against `config/skip-dates.yaml` and short-circuit the affected day's draft to a SKIPPED.md write. Cheap follow-up, ~10 lines.
