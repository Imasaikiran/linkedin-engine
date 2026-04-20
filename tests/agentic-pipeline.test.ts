import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  runAgenticPipeline,
  AgenticRunSummarySchema,
  computeIsoWeek,
} from '../src/agentic-pipeline.js';
import { makeLogger } from '../src/lib/log.js';
import { loadBrand, type Brand } from '../src/lib/brand.js';
import type { OrchestratorResult } from '../src/agents/orchestrator.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const BRAND: Brand = loadBrand();
const WEEK = '2026-W16';

/**
 * Build a voice-gate-passing post body. Mirrors the helper in tests/lib/voice-gate.test.ts
 * but inlined so we don't cross-import test code.
 */
function buildCleanPost(opts: { bodyPrefix?: string; bodyWords?: number } = {}): string {
  const hookPool = ['What', 'if', 'every', 'release', 'felt', 'like', 'a', 'product', 'launch'];
  const hook = hookPool.slice(0, 8).join(' ');
  const filler = ['Teams', 'ship', 'work', 'with', 'narrative', 'and', 'numbers', 'that', 'land', 'cleanly'];
  const bodyWords = opts.bodyWords ?? 240;
  const wordsNeeded = Math.max(0, bodyWords - 8);
  const tokens: string[] = [];
  for (let i = 0; i < wordsNeeded; i++) tokens.push(filler[i % filler.length]!);
  const wordsPerLine = 5;
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerLine) {
    lines.push(tokens.slice(i, i + wordsPerLine).join(' '));
  }
  const paragraphs: string[] = [];
  const paragraphLines = 3;
  for (let i = 0; i < lines.length; i += paragraphLines) {
    paragraphs.push(lines.slice(i, i + paragraphLines).join('\n'));
  }
  const prefix = opts.bodyPrefix ? `${opts.bodyPrefix}\n\n` : '';
  return `${hook}\n\n${prefix}${paragraphs.join('\n\n')}\n\nDoes your team agree?`;
}

interface MakeOrchestratorResultParams {
  approvedDays?: ('mon' | 'wed' | 'fri')[];
  /** Days to mark as orchestrator-skipped (with critic block verdict). */
  skippedDays?: ('mon' | 'wed' | 'fri')[];
  /** Override post text for a specific day (e.g. inject banned phrase to fail voice gate). */
  postOverrides?: Partial<Record<'mon' | 'wed' | 'fri', string>>;
  aborted?: boolean;
  abortReason?: string;
  cost_usd?: number;
  scout_source?: 'web_search' | 'rss_fallback';
}

function makeOrchestratorResult(p: MakeOrchestratorResultParams = {}): OrchestratorResult {
  const approved = new Set(p.approvedDays ?? ['mon', 'wed', 'fri']);
  const skipped = new Set(p.skippedDays ?? []);
  const aborted = p.aborted ?? false;
  const days = (['mon', 'wed', 'fri'] as const).map((d) => {
    const isSkipped = skipped.has(d) || aborted;
    const isApproved = !isSkipped && approved.has(d);
    const post = p.postOverrides?.[d] ?? buildCleanPost();
    const pillar = d === 'mon' ? 'shipped' : d === 'wed' ? 'framework' : 'critique';
    return {
      day: d,
      draft: {
        post_text: post,
        pillar,
        angle_rationale: `Rationale for ${d}.`,
        cost_usd: 0.012,
        attempt: 0,
      },
      critic_verdict: isApproved
        ? {
            day: d,
            verdict: 'approve' as const,
            severity: 'soft' as const,
            reasons: ['clean PM POV', 'hook under 10 words'],
            specific_fixes: [],
          }
        : {
            day: d,
            verdict: 'fix' as const,
            severity: 'block' as const,
            reasons: aborted
              ? [`aborted: ${p.abortReason ?? 'unknown'}`]
              : ['Hook is generic.', 'No named product.'],
            specific_fixes: aborted
              ? []
              : ['Rewrite line 1 with a specific number.'],
          },
      retries: isApproved ? 0 : aborted ? 0 : 2,
      approved: isApproved,
      skipped: !isApproved,
    };
  });
  return {
    week: WEEK,
    days,
    scout_source: p.scout_source ?? 'web_search',
    cost_usd: p.cost_usd ?? 0.04,
    wall_ms: 12_345,
    aborted,
    abort_reason: aborted ? p.abortReason ?? 'wall_time_exceeded' : undefined,
  };
}

interface TmpDirs {
  dataDir: string;
  draftsRoot: string;
  qualityPath: string;
  logFilePath: string;
}

function makeTmpDirs(): TmpDirs {
  const root = mkdtempSync(join(tmpdir(), 'agentic-pipeline-test-'));
  return {
    dataDir: join(root, 'data'),
    draftsRoot: join(root, 'drafts'),
    qualityPath: join(root, 'QUALITY.md'),
    logFilePath: join(root, 'logs', 'agentic-pipeline.log'),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Happy path — 3 approved drafts published
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — happy path', () => {
  it('publishes 3 .md drafts and writes a clean run summary', async () => {
    const dirs = makeTmpDirs();
    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () => makeOrchestratorResult(),
    });

    expect(result.exitCode).toBe(0);
    for (const day of ['mon', 'wed', 'fri'] as const) {
      const path = join(dirs.draftsRoot, WEEK, `${day}.md`);
      expect(existsSync(path)).toBe(true);
      const md = readFileSync(path, 'utf8');
      expect(md).toContain(`day: ${day}`);
      expect(md).toContain(`week: ${WEEK}`);
      expect(md).toMatch(/pillar:/);
    }

    const summaryPath = join(dirs.dataDir, 'runs', `${WEEK}.json`);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(summary.drafts_produced).toBe(3);
    expect(summary.drafts_skipped).toBe(0);
    expect(summary.aborted).toBe(false);
    expect(summary.days).toHaveLength(3);
    expect(summary.days.every((d: { status: string }) => d.status === 'published')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. One orchestrator-skipped day
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — one skipped day', () => {
  it('writes wed.SKIPPED.md with the critic block reason and counts 2 produced', async () => {
    const dirs = makeTmpDirs();
    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: ['mon', 'fri'],
          skippedDays: ['wed'],
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'mon.md'))).toBe(true);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'fri.md'))).toBe(true);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'wed.md'))).toBe(false);

    const skippedPath = join(dirs.draftsRoot, WEEK, 'wed.SKIPPED.md');
    expect(existsSync(skippedPath)).toBe(true);
    const skippedContent = readFileSync(skippedPath, 'utf8');
    expect(skippedContent).toContain('Critic block');
    expect(skippedContent).toContain('Hook is generic');

    const summary = JSON.parse(
      readFileSync(join(dirs.dataDir, 'runs', `${WEEK}.json`), 'utf8'),
    );
    expect(summary.drafts_produced).toBe(2);
    expect(summary.drafts_skipped).toBe(1);
    const wed = summary.days.find((d: { day: string }) => d.day === 'wed');
    expect(wed.status).toBe('skipped');
    expect(wed.reason).toMatch(/critic_block/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Voice-gate fails on a critic-approved draft (system bug)
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — voice gate fails post-approval', () => {
  it('marks the day as gate_fail SKIPPED, does NOT publish, and logs error', async () => {
    const dirs = makeTmpDirs();
    // Use a word-count violation (50 words < 180 floor) — the gate has no
    // sanitizer for this, so it MUST fail and skip. Banned-phrase failures
    // are now scrubbed pre-gate; covered by the next test.
    const bannedPost = buildCleanPost({ bodyWords: 50 });

    // Inject a synchronous logger so we can assert on the error-level call
    // directly, without sleeping for pino's async destination to flush.
    const errorSpy = vi.fn();
    const loggerOverride = {
      error: errorSpy,
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    } as unknown as Logger;

    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      loggerOverride,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: ['mon', 'wed', 'fri'],
          postOverrides: { wed: bannedPost },
        }),
    });

    expect(result.exitCode).toBe(0); // 2 still published, exit OK
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'mon.md'))).toBe(true);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'fri.md'))).toBe(true);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'wed.md'))).toBe(false);

    const skippedPath = join(dirs.draftsRoot, WEEK, 'wed.SKIPPED.md');
    expect(existsSync(skippedPath)).toBe(true);
    expect(readFileSync(skippedPath, 'utf8')).toContain('gate_fail');
    expect(readFileSync(skippedPath, 'utf8')).toMatch(/word count/);

    const summary = JSON.parse(
      readFileSync(join(dirs.dataDir, 'runs', `${WEEK}.json`), 'utf8'),
    );
    expect(summary.drafts_produced).toBe(2);
    expect(summary.drafts_skipped).toBe(1);
    const wed = summary.days.find((d: { day: string }) => d.day === 'wed');
    expect(wed.status).toBe('skipped');
    expect(wed.reason).toMatch(/gate_fail/);

    // Assert directly on the captured logger spy — no sleep, no flaky IO.
    expect(errorSpy).toHaveBeenCalled();
    const gateErrorCall = errorSpy.mock.calls.find(
      (call) =>
        typeof call[1] === 'string' &&
        /voice gate failed on critic-approved draft/.test(call[1]),
    );
    expect(gateErrorCall).toBeDefined();
  });

  it('sanitizes banned phrases pre-gate so the draft still publishes', async () => {
    const dirs = makeTmpDirs();
    // "leverage" and "game-changer" are in brand.yaml banned_phrases. The
    // pre-gate sanitizer swaps them for safe alternatives so the gate passes
    // and the post publishes — no SKIPPED, no error log.
    const dirty = buildCleanPost({
      bodyPrefix: 'Teams leverage shared tooling. The game-changer was clear',
    });

    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: ['mon', 'wed', 'fri'],
          postOverrides: { wed: dirty },
        }),
    });

    expect(result.exitCode).toBe(0);
    const wedPath = join(dirs.draftsRoot, WEEK, 'wed.md');
    expect(existsSync(wedPath)).toBe(true);
    expect(existsSync(join(dirs.draftsRoot, WEEK, 'wed.SKIPPED.md'))).toBe(false);
    const wedMd = readFileSync(wedPath, 'utf8');
    expect(wedMd).not.toMatch(/leverage/i);
    expect(wedMd).not.toMatch(/game-changer/i);
    expect(wedMd).toMatch(/\buse\b/);
    expect(wedMd).toMatch(/\bshift\b/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Orchestrator aborts → all 3 days produce SKIPPED.md with abort_reason
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — orchestrator aborts', () => {
  it('writes 3 .SKIPPED.md files with the abort_reason and exits 1', async () => {
    const dirs = makeTmpDirs();
    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          aborted: true,
          abortReason: 'wall_time_exceeded',
        }),
    });

    expect(result.exitCode).toBe(1);
    for (const day of ['mon', 'wed', 'fri'] as const) {
      const skippedPath = join(dirs.draftsRoot, WEEK, `${day}.SKIPPED.md`);
      expect(existsSync(skippedPath)).toBe(true);
      const md = readFileSync(skippedPath, 'utf8');
      expect(md).toContain('Run aborted');
      expect(md).toContain('wall_time_exceeded');
      expect(existsSync(join(dirs.draftsRoot, WEEK, `${day}.md`))).toBe(false);
    }

    const summary = JSON.parse(
      readFileSync(join(dirs.dataDir, 'runs', `${WEEK}.json`), 'utf8'),
    );
    expect(summary.aborted).toBe(true);
    expect(summary.abort_reason).toBe('wall_time_exceeded');
    expect(summary.drafts_produced).toBe(0);
    expect(summary.drafts_skipped).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Summary JSON shape matches the exported zod schema
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — summary JSON schema', () => {
  it('writes a data/runs/<week>.json that parses against AgenticRunSummarySchema', async () => {
    const dirs = makeTmpDirs();
    await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: ['mon', 'fri'],
          skippedDays: ['wed'],
          cost_usd: 0.0421,
        }),
    });

    const raw = JSON.parse(
      readFileSync(join(dirs.dataDir, 'runs', `${WEEK}.json`), 'utf8'),
    );
    const parsed = AgenticRunSummarySchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.total_cost_usd).toBeCloseTo(parsed.data.orchestrator_cost_usd);
      expect(parsed.data.week).toBe(WEEK);
      expect(parsed.data.scout_source).toBe('web_search');
      expect(parsed.data.days).toHaveLength(3);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. QUALITY.md is appended with a row matching the legacy format
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — QUALITY.md append', () => {
  it('creates QUALITY.md with header + row when missing', async () => {
    const dirs = makeTmpDirs();
    await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () => makeOrchestratorResult({ cost_usd: 0.0234 }),
    });

    const md = readFileSync(dirs.qualityPath, 'utf8');
    expect(md).toContain('| week | drafts | skipped | total_cost | duration_s |');
    // Row: | 2026-W16 | 3 | 0 | $0.02 | 12.3 |
    expect(md).toMatch(new RegExp(`\\| ${WEEK} \\| 3 \\| 0 \\| \\$0\\.02 \\| 12\\.3 \\|`));
  });

  it('appends a new row when QUALITY.md already exists', async () => {
    const dirs = makeTmpDirs();
    writeFileSync(
      dirs.qualityPath,
      '# QUALITY\n\n| week | drafts | skipped | total_cost | duration_s |\n|---|---|---|---|---|\n| 2026-W15 | 3 | 0 | $0.05 | 60.0 |\n',
    );
    await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () => makeOrchestratorResult({ cost_usd: 0.03 }),
    });
    const md = readFileSync(dirs.qualityPath, 'utf8');
    expect(md).toMatch(/2026-W15/);
    expect(md).toMatch(new RegExp(`\\| ${WEEK} \\|`));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. All-skipped → exit code 1; partial success → 0
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — exit codes', () => {
  it('returns exitCode 1 when every day is skipped', async () => {
    const dirs = makeTmpDirs();
    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: [],
          skippedDays: ['mon', 'wed', 'fri'],
        }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.summary.drafts_produced).toBe(0);
    expect(result.summary.drafts_skipped).toBe(3);
  });

  it('returns exitCode 0 when at least one day is published', async () => {
    const dirs = makeTmpDirs();
    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () =>
        makeOrchestratorResult({
          approvedDays: ['mon'],
          skippedDays: ['wed', 'fri'],
        }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.summary.drafts_produced).toBe(1);
    expect(result.summary.drafts_skipped).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. FS containment — a single-day write failure must not kill the summary
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — fs error containment', () => {
  it('marks wed as fs_error, still produces mon/fri drafts, still writes summary.json', async () => {
    const dirs = makeTmpDirs();

    // ESM `spyOn` can't redefine `node:fs` exports, so use `vi.doMock` with
    // dynamic import instead. The mock conditionally throws only for the wed
    // draft write; every other write passes through to the real impl.
    const realFs = await import('node:fs');
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...realFs,
      default: realFs,
      writeFileSync: (
        path: unknown,
        data: unknown,
        ...rest: unknown[]
      ): void => {
        if (typeof path === 'string' && path.endsWith(join(WEEK, 'wed.md'))) {
          throw new Error('ENOSPC: simulated disk full');
        }
        (realFs.writeFileSync as unknown as (
          p: unknown,
          d: unknown,
          ...r: unknown[]
        ) => void)(path, data, ...rest);
      },
    }));

    try {
      const { runAgenticPipeline: runPipeline, AgenticRunSummarySchema: Schema } =
        await import('../src/agentic-pipeline.js');

      const result = await runPipeline({
        brand: BRAND,
        week: WEEK,
        ...dirs,
        client: {} as Anthropic,
        orchestratorOverride: async () => makeOrchestratorResult(),
      });

      // Pipeline did NOT throw — it absorbed the fs error.
      expect(result).toBeDefined();

      // mon and fri still land.
      expect(existsSync(join(dirs.draftsRoot, WEEK, 'mon.md'))).toBe(true);
      expect(existsSync(join(dirs.draftsRoot, WEEK, 'fri.md'))).toBe(true);
      expect(existsSync(join(dirs.draftsRoot, WEEK, 'wed.md'))).toBe(false);

      // Summary still written and parses clean against the schema.
      const summaryPath = join(dirs.dataDir, 'runs', `${WEEK}.json`);
      expect(existsSync(summaryPath)).toBe(true);
      const raw = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const parsed = Schema.safeParse(raw);
      expect(parsed.success).toBe(true);

      // wed entry marked fs_error with the original error message.
      const wed = raw.days.find((d: { day: string }) => d.day === 'wed');
      expect(wed.status).toBe('skipped');
      expect(wed.reason_class).toBe('fs_error');
      expect(wed.reason).toMatch(/ENOSPC/);

      // QUALITY.md row still appended (try/finally covered it).
      expect(existsSync(dirs.qualityPath)).toBe(true);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Frontmatter YAML escaping — pillar containing special chars round-trips
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — yaml frontmatter escaping', () => {
  it('round-trips a pillar value containing YAML-hostile characters', async () => {
    const dirs = makeTmpDirs();
    // Synthetic — the real orchestrator never emits this, but defense in
    // depth is the whole point. A bare `:` plus leading space would break
    // unquoted YAML.
    const nastyPillar = 'shipped: ready #1 "yes"';

    // Swap in an orchestrator result with the nasty pillar on mon.
    const base = makeOrchestratorResult({ approvedDays: ['mon'], skippedDays: ['wed', 'fri'] });
    const monIdx = base.days.findIndex((d) => d.day === 'mon');
    const monDay = base.days[monIdx]!;
    base.days[monIdx] = {
      ...monDay,
      draft: { ...monDay.draft, pillar: nastyPillar },
    } as typeof monDay;

    await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
      orchestratorOverride: async () => base,
    });

    const md = readFileSync(join(dirs.draftsRoot, WEEK, 'mon.md'), 'utf8');
    // Extract frontmatter (between first two '---' delimiters).
    const match = md.match(/^---\n([\s\S]*?)\n---\n/);
    expect(match).not.toBeNull();
    const fm = parseYaml(match![1]!);
    expect(fm.pillar).toBe(nastyPillar);
    expect(fm.week).toBe(WEEK);
    expect(fm.day).toBe('mon');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. Client contract — missing client AND override => clear error
// ────────────────────────────────────────────────────────────────────────────
describe('runAgenticPipeline — client contract', () => {
  it('throws a clear error when neither client nor orchestratorOverride is provided', async () => {
    const dirs = makeTmpDirs();
    await expect(
      runAgenticPipeline({
        brand: BRAND,
        week: WEEK,
        ...dirs,
        // no client, no orchestratorOverride
      }),
    ).rejects.toThrow(/either client or orchestratorOverride is required/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 11. makeLogger sync option flushes immediately to disk
// ────────────────────────────────────────────────────────────────────────────
describe('makeLogger — sync option', () => {
  it('writes log line to file without waiting for async flush', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-sync-test-'));
    const logFile = join(dir, 'sync.log');
    const log = makeLogger({ name: 'sync-test', filePath: logFile, sync: true });
    log.info({ probe: 'marker' }, 'sync line');
    // No sleep — sync destination must have written before this reads.
    const content = readFileSync(logFile, 'utf8');
    expect(content).toContain('sync line');
    expect(content).toContain('marker');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helper sanity check
// ────────────────────────────────────────────────────────────────────────────
describe('computeIsoWeek (re-exported)', () => {
  it('matches legacy format for a known date', () => {
    expect(computeIsoWeek(new Date('2026-04-20T00:00:00Z'))).toBe('2026-W17');
  });
});
