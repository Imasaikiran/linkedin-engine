import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOrchestrator } from '../../src/agents/orchestrator.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';
import * as strategistMod from '../../src/agents/strategist.js';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- fixtures ----------
function getBrand(): Brand {
  return loadBrand();
}

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
}

const SCOUT_PAYLOAD = {
  trending_topics: [
    {
      title: 'Agent SDK 1.0 launch',
      url: 'https://www.anthropic.com/news/agent-sdk',
      summary: 'Anthropic released the Agent SDK.',
    },
    {
      title: 'Eval harness comparison',
      url: 'https://anthropic.test/eval-post',
      summary: 'Comparison of agent evaluation harnesses.',
    },
  ],
  recent_launches: [
    {
      title: 'OpenAI responses API',
      url: 'https://openai.com/blog/responses-api',
      summary: 'OpenAI replaced assistants with responses.',
    },
  ],
  engagement_signals: ['Posts comparing Claude and GPT get 3x engagement'],
};

const STRATEGIST_PAYLOAD = {
  angles: [
    {
      day: 'mon',
      pillar: 'shipped',
      hook_idea: 'Shipped Agent SDK 1.0 in 6 weeks',
      why_it_works: 'Frontier-lab PMs care about shipping cadence with specific numbers.',
      sources: ['https://www.anthropic.com/news/agent-sdk'],
      cluster_topic: 'agent-sdk',
    },
    {
      day: 'wed',
      pillar: 'framework',
      hook_idea: '3 reasons your agent eval harness misses the only metric',
      why_it_works: 'Save-worthy framework targeting eng leads.',
      sources: ['https://anthropic.test/eval-post'],
    },
    {
      day: 'fri',
      pillar: 'critique',
      hook_idea: 'OpenAI is wrong about deprecating assistants',
      why_it_works: 'Contrarian-but-charitable take on a named recent launch.',
      sources: ['https://openai.com/blog/responses-api'],
    },
  ],
};

function draftPayloadFor(day: 'mon' | 'wed' | 'fri') {
  const pillar = day === 'mon' ? 'shipped' : day === 'wed' ? 'framework' : 'critique';
  return {
    post_text: `Hook line for ${day}.\n\nBody about shipping with a 40% metric and a named product.\n\nClosing question?`,
    claims: [
      {
        claim_text: '40% latency drop',
        type: 'stat',
        source_url: 'https://www.anthropic.com/news/agent-sdk',
        confidence: 0.8,
      },
    ],
    pillar,
    angle_rationale: `Concrete PM take for ${day}.`,
  };
}

const APPROVE_VERDICT = {
  verdict: 'approve',
  severity: 'soft',
  reasons: ['clean PM POV', 'hook under 10 words'],
  specific_fixes: [],
};

const FIX_BLOCK_VERDICT = {
  verdict: 'fix',
  severity: 'block',
  reasons: ['Hook is generic.', 'No named product.'],
  specific_fixes: [
    'Rewrite line 1 with a specific number.',
    'Add a named product in line 3.',
  ],
};

const FIX_SOFT_VERDICT = {
  verdict: 'fix',
  severity: 'soft',
  reasons: ['Closing could be tighter.'],
  specific_fixes: [],
};

// ---------- routed-mock client ----------
/**
 * A mock client that inspects each call's system+user text and returns the
 * right payload per agent. Each handler receives the full call counter so
 * tests can route based on "first drafter call" vs "retry drafter call".
 */
interface Handlers {
  scout?: () => { text: string; usage?: { input_tokens: number; output_tokens: number } };
  strategist?: () => { text: string; usage?: { input_tokens: number; output_tokens: number } };
  drafter?: (ctx: { day: 'mon' | 'wed' | 'fri'; isRetry: boolean; callNo: number; input: any }) => {
    text: string;
    usage?: { input_tokens: number; output_tokens: number };
    delayMs?: number;
  };
  critic?: (ctx: { day: 'mon' | 'wed' | 'fri'; callNo: number; input: any }) => {
    text: string;
    usage?: { input_tokens: number; output_tokens: number };
    delayMs?: number;
  };
}

function makeRoutedClient(handlers: Handlers) {
  let callNo = 0;
  const calls: any[] = [];
  const create = vi.fn(async (input: any) => {
    const idx = callNo++;
    calls.push(input);
    const system: string = input.system ?? '';
    const userMsg: string = input.messages?.[0]?.content ?? '';

    let text = '{}';
    let usage = { input_tokens: 500, output_tokens: 400 };
    let delayMs = 0;

    if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
      const r = handlers.scout?.();
      if (r) {
        text = r.text;
        if (r.usage) usage = r.usage;
      }
    } else if (system.includes('PM Strategist')) {
      const r = handlers.strategist?.();
      if (r) {
        text = r.text;
        if (r.usage) usage = r.usage;
      }
    } else if (
      system.startsWith('You are Drafter') ||
      system.includes('LinkedIn post per')
    ) {
      const day: 'mon' | 'wed' | 'fri' = userMsg.includes('(mon')
        ? 'mon'
        : userMsg.includes('(wed')
          ? 'wed'
          : userMsg.includes('(fri')
            ? 'fri'
            : userMsg.includes('DAY: mon')
              ? 'mon'
              : userMsg.includes('DAY: wed')
                ? 'wed'
                : 'fri';
      const isRetry = system.includes('SURGICAL') || system.toLowerCase().includes('surgical');
      const r = handlers.drafter?.({ day, isRetry, callNo: idx, input });
      if (r) {
        text = r.text;
        if (r.usage) usage = r.usage;
        if (r.delayMs) delayMs = r.delayMs;
      }
    } else if (system.includes('Senior Product Manager')) {
      const day: 'mon' | 'wed' | 'fri' = userMsg.includes('DAY: mon')
        ? 'mon'
        : userMsg.includes('DAY: wed')
          ? 'wed'
          : 'fri';
      const r = handlers.critic?.({ day, callNo: idx, input });
      if (r) {
        text = r.text;
        if (r.usage) usage = r.usage;
        if (r.delayMs) delayMs = r.delayMs;
      }
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return {
      content: [{ type: 'text', text }],
      usage,
    };
  });
  return { client: { messages: { create } } as any, calls, create };
}

// ---------- 1. happy path ----------
describe('runOrchestrator — happy path', () => {
  it('returns 3 approved days with zero retries and summed cost', async () => {
    const brand = getBrand();
    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day }) => ({ text: JSON.stringify(draftPayloadFor(day)) }),
      critic: () => ({ text: JSON.stringify(APPROVE_VERDICT) }),
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    expect(out.abort_reason).toBeUndefined();
    expect(out.days).toHaveLength(3);
    expect(out.days.every((d) => d.approved)).toBe(true);
    expect(out.days.every((d) => !d.skipped)).toBe(true);
    expect(out.days.every((d) => d.retries === 0)).toBe(true);
    expect(out.cost_usd).toBeGreaterThan(0);
    expect(out.wall_ms).toBeGreaterThanOrEqual(0);
    expect(out.scout_source).toBe('web_search');
  });
});

// ---------- 2. single retry succeeds ----------
describe('runOrchestrator — single retry succeeds', () => {
  it('re-drafts mon once, then approves', async () => {
    const brand = getBrand();
    let monCriticCalls = 0;
    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day }) => ({ text: JSON.stringify(draftPayloadFor(day)) }),
      critic: ({ day }) => {
        if (day === 'mon') {
          monCriticCalls++;
          // First critic pass: reject mon. Retry pass: approve.
          return {
            text: JSON.stringify(
              monCriticCalls === 1 ? FIX_BLOCK_VERDICT : APPROVE_VERDICT,
            ),
          };
        }
        return { text: JSON.stringify(APPROVE_VERDICT) };
      },
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    const mon = out.days.find((d) => d.day === 'mon')!;
    expect(mon.retries).toBe(1);
    expect(mon.approved).toBe(true);
    expect(mon.skipped).toBe(false);
    const wed = out.days.find((d) => d.day === 'wed')!;
    const fri = out.days.find((d) => d.day === 'fri')!;
    expect(wed.retries).toBe(0);
    expect(fri.retries).toBe(0);
  });
});

// ---------- 3. max retries exhausted ----------
describe('runOrchestrator — retries exhausted', () => {
  it('marks mon skipped after max_retry_loops of block', async () => {
    const brand = getBrand();
    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day }) => ({ text: JSON.stringify(draftPayloadFor(day)) }),
      critic: ({ day }) => {
        if (day === 'mon') return { text: JSON.stringify(FIX_BLOCK_VERDICT) };
        return { text: JSON.stringify(APPROVE_VERDICT) };
      },
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    const mon = out.days.find((d) => d.day === 'mon')!;
    expect(mon.retries).toBe(brand.agents.max_retry_loops);
    expect(mon.approved).toBe(false);
    expect(mon.skipped).toBe(true);
    const wed = out.days.find((d) => d.day === 'wed')!;
    expect(wed.approved).toBe(true);
  });
});

// ---------- 4. parallel drafter + critic ----------
describe('runOrchestrator — parallelism', () => {
  it('both drafter and critic fan out to peakInFlight == 3 on the initial pass', async () => {
    const brand = getBrand();

    let drafterInFlight = 0;
    let drafterPeak = 0;
    const drafterAllStarted = deferredBarrier(() => drafterInFlight >= 3);

    let criticInFlight = 0;
    let criticPeak = 0;
    const criticAllStarted = deferredBarrier(() => criticInFlight >= 3);

    const create = vi.fn(async (input: any) => {
      const system: string = input.system ?? '';
      const userMsg: string = input.messages?.[0]?.content ?? '';

      if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
        return {
          content: [{ type: 'text', text: JSON.stringify(SCOUT_PAYLOAD) }],
          usage: { input_tokens: 200, output_tokens: 200 },
        };
      }
      if (system.includes('PM Strategist')) {
        return {
          content: [{ type: 'text', text: JSON.stringify(STRATEGIST_PAYLOAD) }],
          usage: { input_tokens: 400, output_tokens: 300 },
        };
      }
      if (system.startsWith('You are Drafter')) {
        drafterInFlight++;
        drafterPeak = Math.max(drafterPeak, drafterInFlight);
        await drafterAllStarted.promise;
        drafterInFlight--;
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('(mon')
          ? 'mon'
          : userMsg.includes('(wed')
            ? 'wed'
            : 'fri';
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(day)) }],
          usage: { input_tokens: 500, output_tokens: 400 },
        };
      }
      if (system.includes('Senior Product Manager')) {
        criticInFlight++;
        criticPeak = Math.max(criticPeak, criticInFlight);
        await criticAllStarted.promise;
        criticInFlight--;
        return {
          content: [{ type: 'text', text: JSON.stringify(APPROVE_VERDICT) }],
          usage: { input_tokens: 300, output_tokens: 100 },
        };
      }
      return {
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(drafterPeak).toBe(3);
    expect(criticPeak).toBe(3);
    expect(out.aborted).toBe(false);
    expect(out.days.every((d) => d.approved)).toBe(true);
  });
});

// ---------- 5. cost budget abort ----------
describe('runOrchestrator — cost budget abort', () => {
  it('aborts when scout cost exceeds budget', async () => {
    const brand = getBrand();
    // Budget is $0.50. Haiku pricing is $1/M input, $5/M output.
    // 1M input + 1M output = $6 cost. Well above budget.
    const { client } = makeRoutedClient({
      scout: () => ({
        text: JSON.stringify(SCOUT_PAYLOAD),
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day }) => ({ text: JSON.stringify(draftPayloadFor(day)) }),
      critic: () => ({ text: JSON.stringify(APPROVE_VERDICT) }),
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(true);
    expect(out.abort_reason).toMatch(/cost/i);
    expect(out.days.every((d) => d.skipped)).toBe(true);
    expect(out.days.every((d) => !d.approved)).toBe(true);
  });
});

// ---------- 6. wall time abort ----------
describe('runOrchestrator — wall time abort', () => {
  it('aborts when cumulative wall time exceeds budget', async () => {
    const baseBrand = getBrand();
    // Clone brand and shrink wall_time_seconds to 1 second so a 1.2s scout
    // delay trips the guard. Keep the rest of brand intact.
    const brand: Brand = {
      ...baseBrand,
      budgets: {
        ...baseBrand.budgets,
        wall_time_seconds: 1,
      },
    };
    const create = vi.fn(async (input: any) => {
      const system: string = input.system ?? '';
      if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
        await new Promise((r) => setTimeout(r, 1200));
        return {
          content: [{ type: 'text', text: JSON.stringify(SCOUT_PAYLOAD) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(STRATEGIST_PAYLOAD) }],
        usage: { input_tokens: 100, output_tokens: 100 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(true);
    expect(out.abort_reason).toMatch(/wall|time/i);
    expect(out.days.every((d) => d.skipped)).toBe(true);
  });
});

// ---------- 7. soft fix is approved, no retry ----------
describe('runOrchestrator — soft fix is approved', () => {
  it('treats fix+soft as approved with retries=0', async () => {
    const brand = getBrand();
    const drafterCalls: string[] = [];
    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day, isRetry }) => {
        drafterCalls.push(`${day}:${isRetry ? 'retry' : 'init'}`);
        return { text: JSON.stringify(draftPayloadFor(day)) };
      },
      critic: ({ day }) => {
        if (day === 'mon') return { text: JSON.stringify(FIX_SOFT_VERDICT) };
        return { text: JSON.stringify(APPROVE_VERDICT) };
      },
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    const mon = out.days.find((d) => d.day === 'mon')!;
    expect(mon.approved).toBe(true);
    expect(mon.skipped).toBe(false);
    expect(mon.retries).toBe(0);
    // No surgical retry should have fired.
    expect(drafterCalls.every((c) => c.endsWith('init'))).toBe(true);
  });
});

// ---------- 8. recentAngles override surfaces in strategist user prompt ----------
describe('runOrchestrator — recentAngles dedupe', () => {
  it('passes recentAnglesOverride through to the strategist user prompt', async () => {
    const brand = getBrand();
    let strategistUserPrompt = '';
    const create = vi.fn(async (input: any) => {
      const system: string = input.system ?? '';
      const userMsg: string = input.messages?.[0]?.content ?? '';
      if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
        return {
          content: [{ type: 'text', text: JSON.stringify(SCOUT_PAYLOAD) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      if (system.includes('PM Strategist')) {
        strategistUserPrompt = userMsg;
        return {
          content: [{ type: 'text', text: JSON.stringify(STRATEGIST_PAYLOAD) }],
          usage: { input_tokens: 200, output_tokens: 200 },
        };
      }
      if (system.startsWith('You are Drafter')) {
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('(mon')
          ? 'mon'
          : userMsg.includes('(wed')
            ? 'wed'
            : 'fri';
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(day)) }],
          usage: { input_tokens: 300, output_tokens: 200 },
        };
      }
      if (system.includes('Senior Product Manager')) {
        return {
          content: [{ type: 'text', text: JSON.stringify(APPROVE_VERDICT) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      return {
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const client = { messages: { create } } as any;

    await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
      recentAnglesOverride: [
        {
          day: 'mon',
          cluster_topic: 'old topic about RAG',
          hook_idea: 'old hook about retrievers',
        },
      ],
    });

    expect(strategistUserPrompt).toContain('old topic about RAG');
    expect(strategistUserPrompt).toContain('old hook about retrievers');
  });
});

// ---------- 9. missing voice corpus dir is tolerated ----------
describe('runOrchestrator — missing voice corpus', () => {
  it('runs without throwing when data/voice-corpus/external is absent', async () => {
    const brand = getBrand();
    // tmp dataDir has no voice-corpus/external subdir.
    const captured: any[] = [];
    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      strategist: () => ({ text: JSON.stringify(STRATEGIST_PAYLOAD) }),
      drafter: ({ day, input }) => {
        captured.push(input);
        return { text: JSON.stringify(draftPayloadFor(day)) };
      },
      critic: () => ({ text: JSON.stringify(APPROVE_VERDICT) }),
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    expect(out.days.every((d) => d.approved)).toBe(true);
    // Drafter user prompts should contain an empty SAMPLE block.
    // We can't easily check "SAMPLE N" absence (the block is just empty string
    // joined with `---`), so instead confirm no sample body leaked in.
    for (const c of captured) {
      const user: string = c.messages[0].content;
      expect(user).not.toContain('SAMPLE 2:');
    }
  });
});

// ---------- 10. surgical retry prompt includes reasons + fixes + 'previous' ----------
describe('runOrchestrator — surgical retry prompt', () => {
  it('retry call prompt contains verdict.reasons, specific_fixes, and "previous"', async () => {
    const brand = getBrand();
    const retryCalls: any[] = [];
    let monCriticCalls = 0;

    const create = vi.fn(async (input: any) => {
      const system: string = input.system ?? '';
      const userMsg: string = input.messages?.[0]?.content ?? '';

      if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
        return {
          content: [{ type: 'text', text: JSON.stringify(SCOUT_PAYLOAD) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      if (system.includes('PM Strategist')) {
        return {
          content: [{ type: 'text', text: JSON.stringify(STRATEGIST_PAYLOAD) }],
          usage: { input_tokens: 200, output_tokens: 200 },
        };
      }
      if (system.includes('SURGICAL')) {
        // This is the retry path.
        retryCalls.push({ system, user: userMsg });
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor('mon')) }],
          usage: { input_tokens: 300, output_tokens: 200 },
        };
      }
      if (system.startsWith('You are Drafter')) {
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('(mon')
          ? 'mon'
          : userMsg.includes('(wed')
            ? 'wed'
            : 'fri';
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(day)) }],
          usage: { input_tokens: 300, output_tokens: 200 },
        };
      }
      if (system.includes('Senior Product Manager')) {
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('DAY: mon')
          ? 'mon'
          : userMsg.includes('DAY: wed')
            ? 'wed'
            : 'fri';
        if (day === 'mon') {
          monCriticCalls++;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  monCriticCalls === 1 ? FIX_BLOCK_VERDICT : APPROVE_VERDICT,
                ),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 100 },
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(APPROVE_VERDICT) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      return {
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(retryCalls.length).toBeGreaterThanOrEqual(1);
    const retry = retryCalls[0]!;
    for (const reason of FIX_BLOCK_VERDICT.reasons) {
      expect(retry.user).toContain(reason);
    }
    for (const fix of FIX_BLOCK_VERDICT.specific_fixes) {
      expect(retry.user).toContain(fix);
    }
    // "previous" should appear in the user prompt (we use "PREVIOUS DRAFT").
    expect(retry.user.toLowerCase()).toContain('previous');
    // Surgical-edit instruction should mention MINIMAL edits.
    expect(retry.system).toMatch(/MINIMAL|surgical|preserve/i);

    // And the overall run should have approved mon on the retry.
    const mon = out.days.find((d) => d.day === 'mon')!;
    expect(mon.retries).toBe(1);
    expect(mon.approved).toBe(true);
  });
});

// ---------- 11. partial retry failure resilience ----------
describe('runOrchestrator — partial retry failure resilience', () => {
  it('one day retry rejects, other days succeed, cost still accounted for', async () => {
    const brand = getBrand();
    // Drive mon + wed to block on the initial critic pass. The retry drafter
    // returns unparseable text for wed (forces surgicalRetry to throw) but
    // approves mon. fri stays approved throughout.
    let monCriticCalls = 0;
    let wedCriticCalls = 0;

    const create = vi.fn(async (input: any) => {
      const system: string = input.system ?? '';
      const userMsg: string = input.messages?.[0]?.content ?? '';

      if (system.includes('Trend Scout') || Array.isArray(input.tools)) {
        return {
          content: [{ type: 'text', text: JSON.stringify(SCOUT_PAYLOAD) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      if (system.includes('PM Strategist')) {
        return {
          content: [{ type: 'text', text: JSON.stringify(STRATEGIST_PAYLOAD) }],
          usage: { input_tokens: 200, output_tokens: 200 },
        };
      }
      if (system.includes('SURGICAL')) {
        // Retry path. mon -> valid draft. wed -> unparseable garbage so the
        // surgicalRetry throws. fri should not hit this path.
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('DAY: mon')
          ? 'mon'
          : userMsg.includes('DAY: wed')
            ? 'wed'
            : 'fri';
        if (day === 'wed') {
          return {
            content: [{ type: 'text', text: 'not-json-garbage{{{' }],
            usage: { input_tokens: 300, output_tokens: 200 },
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(day)) }],
          usage: { input_tokens: 300, output_tokens: 200 },
        };
      }
      if (system.startsWith('You are Drafter')) {
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('(mon')
          ? 'mon'
          : userMsg.includes('(wed')
            ? 'wed'
            : 'fri';
        return {
          content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(day)) }],
          usage: { input_tokens: 300, output_tokens: 200 },
        };
      }
      if (system.includes('Senior Product Manager')) {
        const day: 'mon' | 'wed' | 'fri' = userMsg.includes('DAY: mon')
          ? 'mon'
          : userMsg.includes('DAY: wed')
            ? 'wed'
            : 'fri';
        if (day === 'mon') {
          monCriticCalls++;
          // First pass -> block. Retry critic pass -> approve.
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  monCriticCalls === 1 ? FIX_BLOCK_VERDICT : APPROVE_VERDICT,
                ),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 100 },
          };
        }
        if (day === 'wed') {
          wedCriticCalls++;
          // Always block; retry never succeeds, so no retry-critic happens.
          return {
            content: [{ type: 'text', text: JSON.stringify(FIX_BLOCK_VERDICT) }],
            usage: { input_tokens: 100, output_tokens: 100 },
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(APPROVE_VERDICT) }],
          usage: { input_tokens: 100, output_tokens: 100 },
        };
      }
      return {
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(out.aborted).toBe(false);
    expect(out.abort_reason).toBeUndefined();

    const mon = out.days.find((d) => d.day === 'mon')!;
    const wed = out.days.find((d) => d.day === 'wed')!;
    const fri = out.days.find((d) => d.day === 'fri')!;

    // mon: retry succeeded -> approved.
    expect(mon.approved).toBe(true);
    expect(mon.skipped).toBe(false);
    expect(mon.retries).toBe(1);

    // wed: retry rejected every attempt, stays blocked & skipped.
    expect(wed.approved).toBe(false);
    expect(wed.skipped).toBe(true);
    // The retry drafter rejects before retriesByDay is bumped, so wed.retries
    // stays at 0 for each exhausted attempt — the run still exits the retry
    // loop because nothing transitions.
    expect(wed.retries).toBe(0);

    // fri: never needed a retry.
    expect(fri.approved).toBe(true);
    expect(fri.skipped).toBe(false);
    expect(fri.retries).toBe(0);

    // Cost must include scout + strategist + drafter + critic + mon retry
    // drafter + mon retry critic (wed's rejected retries spent money too but
    // aren't billed to us since the mock rejects before returning; what we
    // care about is that out.cost_usd is at least the sum of successful
    // pipeline steps plus mon's retry critic).
    expect(out.cost_usd).toBeGreaterThan(0.01);

    // wed's initial critic fired exactly once (the block verdict). No retry
    // critic should have been attempted because retry drafting rejected.
    expect(wedCriticCalls).toBe(1);
  });
});

// ---------- 12. strategist returns < 3 angles ----------
describe('runOrchestrator — strategist_incomplete clean abort', () => {
  it('aborts cleanly with strategist_incomplete reason when angles < 3', async () => {
    const brand = getBrand();
    // Bypass runStrategist's own length(3) schema check by spying at the
    // module boundary — this simulates a future refactor where strategist
    // might return partial output. The orchestrator's defensive guard must
    // catch it with a clean `strategist_incomplete` abort.
    const strategistSpy = vi
      .spyOn(strategistMod, 'runStrategist')
      .mockResolvedValue({
        angles: STRATEGIST_PAYLOAD.angles.slice(0, 2) as any, // only 2 angles
        cost_usd: 0.005,
      } as any);

    const { client } = makeRoutedClient({
      scout: () => ({ text: JSON.stringify(SCOUT_PAYLOAD) }),
      // strategist handler unreachable — spy intercepts runStrategist.
      drafter: ({ day }) => ({ text: JSON.stringify(draftPayloadFor(day)) }),
      critic: () => ({ text: JSON.stringify(APPROVE_VERDICT) }),
    });

    const out = await runOrchestrator({
      client,
      brand,
      week: '2026-W16',
      dataDir: tmpDataDir(),
    });

    expect(strategistSpy).toHaveBeenCalled();
    expect(out.aborted).toBe(true);
    expect(out.abort_reason).toMatch(/strategist_incomplete/);
    // Scout + strategist spend must be reflected (strategist mocked cost 0.005).
    expect(out.cost_usd).toBeGreaterThan(0.005);
    // All 3 days present, all marked skipped.
    expect(out.days).toHaveLength(3);
    expect(out.days.every((d) => d.skipped)).toBe(true);
    expect(out.days.every((d) => !d.approved)).toBe(true);
  });
});

// ---------- helpers ----------
function deferredBarrier(predicate: () => boolean): { promise: Promise<void> } {
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const start = Date.now();
  const interval = setInterval(() => {
    if (predicate()) {
      clearInterval(interval);
      resolveFn();
    } else if (Date.now() - start > 2000) {
      clearInterval(interval);
      resolveFn();
    }
  }, 5);
  return { promise };
}
