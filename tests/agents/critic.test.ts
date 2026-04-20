import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCriticPrompt,
  runCritic,
  runCriticOnce,
  CriticSchemaError,
  type CriticDraftInput,
} from '../../src/agents/critic.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';

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

// Generic blog-style draft: no PM POV, generic opener, no shipping anecdote,
// no framework. Should receive a 'fix' verdict with 'block' severity.
const DRAFT_GENERIC: CriticDraftInput = {
  post_text:
    'AI is transforming everything, and here is why you should care.\n\nEveryone is talking about LLMs and how they will reshape the future.\n\nThe pace of change is incredible and we all need to keep up.\n\nWhat do you think?',
  pillar: 'shipped',
};

// PM-coded draft: shipping anecdote, named product, specific metric, clear PM signal.
const DRAFT_PM_CODED: CriticDraftInput = {
  post_text:
    'Shipped Agent SDK 1.0 in 6 weeks.\n\nWe cut the wrapper layer and kept the router. Users saw a 40% latency drop.\n\nTradeoff: less flexibility per call, but a faster path for the 80% use case.\n\nWhat would you cut first?',
  pillar: 'shipped',
};

const DRAFT_WED: CriticDraftInput = {
  post_text:
    'The SHIP framework: specific, honest, intentional, pragmatic.\n\n1. Specific: name the metric.\n2. Honest: name the tradeoff.\n3. Intentional: name the decision.\n\nWhich one do you skip most?',
  pillar: 'framework',
};

const DRAFT_FRI: CriticDraftInput = {
  post_text:
    'OpenAI is wrong about deprecating assistants. Here is why.\n\nEveryone read the responses API post as a win for developers.\n\nI shipped an assistants integration last quarter; the migration cost my team 3 weeks.\n\nThe charitable read: OpenAI is betting on simpler primitives. The cost: teams mid-migration.\n\nWhere do you land?',
  pillar: 'critique',
};

// ---------- canned critic responses ----------
const RESP_FIX_GENERIC = {
  verdict: 'fix' as const,
  severity: 'block' as const,
  reasons: [
    'No PM signal — generic tech commentary with no product judgment or tradeoffs.',
    "Hook is generic: 'AI is transforming everything' would get scrolled past.",
    'No named product, no specific metric, no shipping anecdote.',
    'No save-worthy artifact — nothing to screenshot or reference later.',
  ],
  specific_fixes: [
    "Replace hook with a specific-number or contradiction opener (e.g. 'Shipped X in 6 weeks. One number changed everything.').",
    'Add a concrete PM decision with a tradeoff and a named product.',
    'End with a sharp question tied to PM audience, not a generic one.',
  ],
};

const RESP_APPROVE_PM = {
  verdict: 'approve' as const,
  severity: 'soft' as const,
  reasons: [
    'Clean PM POV: named product, specific metric, tradeoff called out.',
    'Hook is contradiction-shaped and under 10 words.',
  ],
  specific_fixes: [],
};

// ---------- fake client ----------
interface FakeClientOpts {
  text?: string;
  payload?: unknown;
  textByCall?: string[];
  payloadByCall?: unknown[];
  capture?: (input: any) => void;
  usage?: { input_tokens: number; output_tokens: number };
  usageByCall?: { input_tokens: number; output_tokens: number }[];
}
function makeFakeClient(opts: FakeClientOpts = {}) {
  let calls = 0;
  const create = vi.fn(async (input: any) => {
    opts.capture?.(input);
    const idx = calls++;
    let text = '{}';
    if (opts.text !== undefined) {
      text = opts.text;
    } else if (opts.textByCall && opts.textByCall.length > 0) {
      text = opts.textByCall[idx] ?? opts.textByCall[opts.textByCall.length - 1]!;
    } else if (opts.payloadByCall && opts.payloadByCall.length > 0) {
      const payload =
        opts.payloadByCall[idx] ?? opts.payloadByCall[opts.payloadByCall.length - 1];
      text = JSON.stringify(payload);
    } else if (opts.payload !== undefined) {
      text = JSON.stringify(opts.payload);
    }
    const usage = opts.usageByCall
      ? opts.usageByCall[idx] ?? opts.usageByCall[opts.usageByCall.length - 1]
      : opts.usage ?? { input_tokens: 400, output_tokens: 200 };
    return {
      content: [{ type: 'text', text }],
      usage,
    };
  });
  return { messages: { create } } as any;
}

// ---------- 1. generic blog-style draft → fix verdict ----------
describe('runCriticOnce — generic draft', () => {
  it('returns a fix verdict with block severity and grafts the correct day', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: RESP_FIX_GENERIC });

    const out = await runCriticOnce({
      client,
      brand,
      draft: DRAFT_GENERIC,
      day: 'mon',
    });

    expect(out.verdict).toEqual({
      day: 'mon',
      verdict: 'fix',
      severity: 'block',
      reasons: RESP_FIX_GENERIC.reasons,
      specific_fixes: RESP_FIX_GENERIC.specific_fixes,
    });
    expect(out.cost_usd).toBeGreaterThan(0);
  });
});

// ---------- 2. PM-coded draft → approve verdict ----------
describe('runCriticOnce — PM-coded draft', () => {
  it('returns an approve verdict with soft severity and empty specific_fixes', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: RESP_APPROVE_PM });

    const out = await runCriticOnce({
      client,
      brand,
      draft: DRAFT_PM_CODED,
      day: 'mon',
    });

    expect(out.verdict).toEqual({
      day: 'mon',
      verdict: 'approve',
      severity: 'soft',
      reasons: RESP_APPROVE_PM.reasons,
      specific_fixes: [],
    });
  });
});

// ---------- 3. parallel execution proof ----------
describe('runCritic — parallelism', () => {
  it('fires all 3 SDK calls before any resolves (Promise.all, not sequential)', async () => {
    const brand = getBrand();
    let inFlight = 0;
    let peakInFlight = 0;
    const allStarted = new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (inFlight >= 3) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > 2000) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });

    const create = vi.fn(async (input: any) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Block until all 3 calls have arrived.
      await allStarted;
      inFlight--;
      // Map day from user message so we return a valid shape regardless.
      const userMsg: string = input.messages[0].content;
      const payload = userMsg.includes('DAY: wed')
        ? RESP_APPROVE_PM
        : userMsg.includes('DAY: fri')
        ? RESP_APPROVE_PM
        : RESP_FIX_GENERIC;
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runCritic({
      client,
      brand,
      drafts: [
        { day: 'mon', draft: DRAFT_GENERIC },
        { day: 'wed', draft: DRAFT_WED },
        { day: 'fri', draft: DRAFT_FRI },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(peakInFlight).toBe(3);
    expect(out.verdicts).toHaveLength(3);
    expect(out.verdicts.map((v) => v.day).sort()).toEqual(['fri', 'mon', 'wed']);
  });
});

// ---------- 4. missing day throws ----------
describe('runCritic — draft validation', () => {
  it('throws when a day is missing', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: RESP_APPROVE_PM });
    await expect(
      runCritic({
        client,
        brand,
        drafts: [
          { day: 'mon', draft: DRAFT_GENERIC },
          { day: 'wed', draft: DRAFT_WED },
        ],
      }),
    ).rejects.toThrow(/expected 3|fri/);
  });

  it('throws on duplicate days', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: RESP_APPROVE_PM });
    await expect(
      runCritic({
        client,
        brand,
        drafts: [
          { day: 'mon', draft: DRAFT_GENERIC },
          { day: 'mon', draft: DRAFT_GENERIC },
          { day: 'fri', draft: DRAFT_FRI },
        ],
      }),
    ).rejects.toThrow(/duplicate/);
  });
});

// ---------- 5. malformed JSON ----------
describe('runCriticOnce — malformed LLM output', () => {
  it('throws CriticSchemaError when LLM returns prose only', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ text: 'I have no opinion today.' });
    await expect(
      runCriticOnce({
        client,
        brand,
        draft: DRAFT_GENERIC,
        day: 'mon',
      }),
    ).rejects.toThrow(/critic/);
  });

  it('throws CriticSchemaError for wrong shape', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: { foo: 'bar' } });
    await expect(
      runCriticOnce({
        client,
        brand,
        draft: DRAFT_GENERIC,
        day: 'mon',
      }),
    ).rejects.toThrow(CriticSchemaError);
  });
});

// ---------- 6. brand-driven model + max_tokens ----------
describe('runCritic — brand-driven config', () => {
  it('passes brand.agents.critic.{model,max_tokens} to client.messages.create', async () => {
    const brand = getBrand();
    const captured: any[] = [];
    const create = vi.fn(async (input: any) => {
      captured.push(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(RESP_APPROVE_PM) }],
        usage: { input_tokens: 400, output_tokens: 200 },
      };
    });
    const client = { messages: { create } } as any;

    await runCritic({
      client,
      brand,
      drafts: [
        { day: 'mon', draft: DRAFT_PM_CODED },
        { day: 'wed', draft: DRAFT_WED },
        { day: 'fri', draft: DRAFT_FRI },
      ],
    });

    expect(captured).toHaveLength(3);
    for (const c of captured) {
      expect(c.model).toBe(brand.agents.critic.model);
      expect(c.max_tokens).toBe(brand.agents.critic.max_tokens);
    }
  });
});

// ---------- 7. prompt content ----------
describe('buildCriticPrompt', () => {
  it('includes audience, checklist items, and draft post_text in the prompts', () => {
    const brand = getBrand();
    const { system, user } = buildCriticPrompt({
      brand,
      draft: DRAFT_PM_CODED,
      day: 'mon',
    });

    // Audience primary is in system prompt.
    expect(system).toContain(brand.identity.audience.primary);
    expect(system).toContain(brand.identity.positioning);

    // Checklist items.
    expect(system).toContain('PM signal');
    expect(system).toContain('Audience-coded');
    expect(system).toContain('Hook strength');
    expect(system).toContain('Save-worthy');
    expect(system).toContain('Engagement pattern');

    // Severity rules.
    expect(system).toContain('block');
    expect(system).toContain('soft');

    // JSON-only instruction.
    expect(system.toLowerCase()).toContain('json');

    // At least one hook pattern from brand.yaml is in the system prompt.
    const hookSamples = brand.engagement.hook_patterns.filter((p) =>
      system.includes(p),
    );
    expect(hookSamples.length).toBeGreaterThanOrEqual(1);

    // User prompt echoes the draft post_text + day + pillar.
    expect(user).toContain(DRAFT_PM_CODED.post_text);
    expect(user).toContain('DAY: mon');
    expect(user).toContain(`PILLAR: ${DRAFT_PM_CODED.pillar}`);
  });
});

// ---------- 8. cost aggregation ----------
describe('runCritic — cost aggregation', () => {
  it('sums cost_usd across all 3 parallel calls', async () => {
    const brand = getBrand();
    // Sonnet 4.6: $3/M input, $15/M output.
    // call 1: 1000 in, 500 out  -> 0.003  + 0.0075 = 0.0105
    // call 2: 2000 in, 600 out  -> 0.006  + 0.009  = 0.015
    // call 3: 800  in, 400 out  -> 0.0024 + 0.006  = 0.0084
    // total = 0.0339
    const create = vi.fn(async (input: any) => {
      const userMsg: string = input.messages[0].content;
      let usage = { input_tokens: 1000, output_tokens: 500 };
      if (userMsg.includes('DAY: wed')) usage = { input_tokens: 2000, output_tokens: 600 };
      else if (userMsg.includes('DAY: fri')) usage = { input_tokens: 800, output_tokens: 400 };
      return {
        content: [{ type: 'text', text: JSON.stringify(RESP_APPROVE_PM) }],
        usage,
      };
    });
    const client = { messages: { create } } as any;

    const out = await runCritic({
      client,
      brand,
      drafts: [
        { day: 'mon', draft: DRAFT_PM_CODED },
        { day: 'wed', draft: DRAFT_WED },
        { day: 'fri', draft: DRAFT_FRI },
      ],
    });

    expect(out.cost_usd).toBeCloseTo(0.0339, 4);
  });
});
