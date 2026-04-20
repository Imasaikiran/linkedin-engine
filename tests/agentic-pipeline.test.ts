import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runAgenticPipeline,
  AgenticRunSummarySchema,
  computeIsoWeek,
} from '../src/agentic-pipeline.js';
import { loadBrand, type Brand } from '../src/lib/brand.js';
import type { OrchestratorResult } from '../src/agents/orchestrator.js';
import type Anthropic from '@anthropic-ai/sdk';

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
    // Inject a banned phrase into the wed post so the voice gate trips even
    // though the orchestrator approved it.
    const bannedPost = buildCleanPost({ bodyPrefix: 'This is a game-changer for teams' });

    const result = await runAgenticPipeline({
      brand: BRAND,
      week: WEEK,
      ...dirs,
      client: {} as Anthropic,
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
    expect(readFileSync(skippedPath, 'utf8')).toContain('game-changer');

    const summary = JSON.parse(
      readFileSync(join(dirs.dataDir, 'runs', `${WEEK}.json`), 'utf8'),
    );
    expect(summary.drafts_produced).toBe(2);
    expect(summary.drafts_skipped).toBe(1);
    const wed = summary.days.find((d: { day: string }) => d.day === 'wed');
    expect(wed.status).toBe('skipped');
    expect(wed.reason).toMatch(/gate_fail/);

    // Verify the error-level log line landed in the log file. Pino's async
    // file destination needs a tick to flush, so we read after a microtask.
    await new Promise((r) => setTimeout(r, 50));
    const logContents = readFileSync(dirs.logFilePath, 'utf8');
    expect(logContents).toMatch(/voice gate failed on critic-approved draft/);
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
// Helper sanity check
// ────────────────────────────────────────────────────────────────────────────
describe('computeIsoWeek (re-exported)', () => {
  it('matches legacy format for a known date', () => {
    expect(computeIsoWeek(new Date('2026-04-20T00:00:00Z'))).toBe('2026-W17');
  });
});
