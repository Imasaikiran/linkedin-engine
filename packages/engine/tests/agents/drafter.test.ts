import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDrafterPrompt,
  runDrafter,
  runDrafterOnce,
  DrafterSchemaError,
  type DrafterSource,
} from '../../src/agents/drafter.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';
import type { StrategistAngle } from '../../src/agents/strategist.js';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- fixtures ----------
function getBrand(): Brand {
  return loadBrand('../../examples/sai-voice/brand.yaml');
}

const ANGLE_MON: StrategistAngle = {
  day: 'mon',
  pillar: 'shipped',
  hook_idea: 'Shipped Agent SDK 1.0 in 6 weeks. One number changed everything.',
  why_it_works: 'Frontier-lab PMs care about shipping cadence with specific numbers.',
  sources: ['https://www.anthropic.com/news/agent-sdk'],
  cluster_topic: 'agent-eval-frameworks',
};

const ANGLE_WED: StrategistAngle = {
  day: 'wed',
  pillar: 'framework',
  hook_idea: '3 reasons your agent eval harness misses the only metric that matters',
  why_it_works: 'Save-worthy framework targeting eng leads.',
  sources: ['https://anthropic.test/eval-post'],
};

const ANGLE_FRI: StrategistAngle = {
  day: 'fri',
  pillar: 'critique',
  hook_idea: 'OpenAI is wrong about deprecating assistants. Here is why.',
  why_it_works: 'Contrarian-but-charitable take on a named, recent launch.',
  sources: ['https://openai.com/blog/responses-api'],
};

const SOURCES_MON: DrafterSource[] = [
  {
    url: 'https://www.anthropic.com/news/agent-sdk',
    body: 'Anthropic released Agent SDK 1.0 with a built-in eval harness.',
  },
];

const SOURCES_WED: DrafterSource[] = [
  {
    url: 'https://anthropic.test/eval-post',
    body: 'Eval harness comparison and the metric that matters.',
  },
];

const SOURCES_FRI: DrafterSource[] = [
  {
    url: 'https://openai.com/blog/responses-api',
    body: 'OpenAI deprecated assistants in favor of responses API.',
  },
];

const VOICE_SAMPLES_MON = [
  'A past-tense sample about shipping a roadmap milestone at a prior gig.',
  'Another short sample showing rhythmic line breaks and one named product.',
];
const VOICE_SAMPLES_WED = ['Framework-style voice sample using a numbered list structure.'];
const VOICE_SAMPLES_FRI = ['Critique-style voice sample with a specific launch reframed charitably.'];

function draftPayloadFor(angle: StrategistAngle) {
  return {
    post_text:
      'Shipped Agent SDK 1.0 in 6 weeks.\n\nWe cut the wrapper layer and kept the router. Users saw a 40% latency drop.\n\nWhat would you cut first?',
    claims: [
      {
        claim_text: '40% latency drop',
        type: 'stat',
        source_url: angle.sources[0],
        confidence: 0.8,
      },
    ],
    pillar: angle.pillar,
    angle_rationale: 'Concrete shipping anecdote with one number and a named product.',
  };
}

// ---------- fake client builder ----------
interface FakeClientOpts {
  text?: string;
  payload?: unknown;
  textByCall?: string[];
  payloadByCall?: unknown[];
  capture?: (input: any) => void;
  usage?: { input_tokens: number; output_tokens: number };
  usageByCall?: { input_tokens: number; output_tokens: number }[];
  throws?: Error;
}
function makeFakeClient(opts: FakeClientOpts = {}) {
  let calls = 0;
  const create = vi.fn(async (input: any) => {
    opts.capture?.(input);
    if (opts.throws) throw opts.throws;
    const idx = calls++;
    let text = '{}';
    if (opts.text !== undefined) {
      text = opts.text;
    } else if (opts.textByCall && opts.textByCall.length > 0) {
      text = opts.textByCall[idx] ?? opts.textByCall[opts.textByCall.length - 1]!;
    } else if (opts.payloadByCall && opts.payloadByCall.length > 0) {
      const p = opts.payloadByCall[idx] ?? opts.payloadByCall[opts.payloadByCall.length - 1];
      text = JSON.stringify(p);
    } else if (opts.payload !== undefined) {
      text = JSON.stringify(opts.payload);
    }
    const usage = opts.usageByCall
      ? opts.usageByCall[idx] ?? opts.usageByCall[opts.usageByCall.length - 1]
      : opts.usage ?? { input_tokens: 500, output_tokens: 400 };
    return {
      content: [{ type: 'text', text }],
      usage,
    };
  });
  return { messages: { create } } as any;
}

// ---------- 1. prompt assembly ----------
describe('buildDrafterPrompt', () => {
  it('assembles system + user prompts with banned phrases, rhythm, template, requires, sources, samples', () => {
    const brand = getBrand();
    const { system, user } = buildDrafterPrompt({
      brand,
      angle: ANGLE_MON,
      sources: SOURCES_MON,
      voiceSamples: VOICE_SAMPLES_MON,
    });

    // System prompt contains banned phrases verbatim (at least 3 from brand.yaml).
    const bannedSamples = ['game-changer', 'thought leader', 'deep dive', 'delve', 'leverage'];
    const hits = bannedSamples.filter((p) => system.includes(p));
    expect(hits.length).toBeGreaterThanOrEqual(3);

    // System prompt contains banned openers.
    expect(system).toContain('I recently');
    expect(system).toContain('Excited to share');

    // Dash rules present.
    expect(system).toMatch(/em_dashes/);
    expect(system).toMatch(/en_dashes/);

    // Rhythm numeric values (from brand.yaml: hook_max_words=10, target_words=[220,280]).
    expect(system).toContain(String(brand.voice.rhythm.hook_max_words));
    expect(system).toContain(String(brand.voice.rhythm.target_words[0]));
    expect(system).toContain(String(brand.voice.rhythm.target_words[1]));

    // must_have_in_every_post items listed.
    expect(system).toContain('first_person_past_tense');
    expect(system).toContain('one_concrete_number');

    // JSON-only instruction.
    expect(system.toLowerCase()).toContain('json');

    // User prompt contains the full cadence template verbatim.
    const monTemplate = brand.cadence.mon.template;
    expect(user).toContain(monTemplate.trim());

    // User prompt contains each requires entry.
    for (const r of brand.cadence.mon.requires) {
      expect(user).toContain(r);
    }

    // User prompt contains angle details.
    expect(user).toContain(ANGLE_MON.hook_idea);
    expect(user).toContain(ANGLE_MON.why_it_works);

    // User prompt contains sources (URL + body prefix).
    expect(user).toContain(SOURCES_MON[0]!.url);
    expect(user).toContain('Anthropic released Agent SDK');

    // User prompt contains voice samples with SAMPLE N markers.
    expect(user).toContain('SAMPLE 1:');
    expect(user).toContain(VOICE_SAMPLES_MON[0]!);
  });
});

// ---------- 2. JSON extraction with prose preamble ----------
describe('runDrafterOnce — JSON extraction', () => {
  it('extracts JSON when the LLM prefixes prose preamble', async () => {
    const brand = getBrand();
    const payload = draftPayloadFor(ANGLE_MON);
    const text = `I'll write this post now.\n\n${JSON.stringify(payload)}`;
    const client = makeFakeClient({ text });
    const draft = await runDrafterOnce({
      client,
      brand,
      angle: ANGLE_MON,
      sources: SOURCES_MON,
      voiceSamples: VOICE_SAMPLES_MON,
    });
    expect(draft.post_text).toContain('Shipped Agent SDK');
    expect(draft.pillar).toBe('shipped');
    expect(draft.attempt).toBe(0);
    expect(draft.cost_usd).toBeGreaterThan(0);
  });

  it('throws DrafterSchemaError when the LLM returns prose only', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ text: 'I do not feel like producing JSON today.' });
    await expect(
      runDrafterOnce({
        client,
        brand,
        angle: ANGLE_MON,
        sources: SOURCES_MON,
        voiceSamples: VOICE_SAMPLES_MON,
      }),
    ).rejects.toThrow(/drafter/);
  });
});

// ---------- 3. parallel execution ----------
describe('runDrafter — parallelism', () => {
  it('fires all 3 SDK calls before any resolves (Promise.all, not sequential)', async () => {
    const brand = getBrand();
    let inFlight = 0;
    let peakInFlight = 0;
    const releaseSignal: Array<() => void> = [];
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
      // Map system+user back to the correct angle so we return the right pillar.
      const userMsg: string = input.messages[0].content;
      let pillar = 'shipped';
      if (userMsg.includes('framework')) pillar = 'framework';
      if (userMsg.includes('critique')) pillar = 'critique';
      const dayAngle =
        pillar === 'shipped' ? ANGLE_MON : pillar === 'framework' ? ANGLE_WED : ANGLE_FRI;
      return {
        content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(dayAngle)) }],
        usage: { input_tokens: 500, output_tokens: 400 },
      };
    });
    const client = { messages: { create } } as any;

    const out = await runDrafter({
      client,
      brand,
      angles: [ANGLE_MON, ANGLE_WED, ANGLE_FRI],
      sourcesByDay: { mon: SOURCES_MON, wed: SOURCES_WED, fri: SOURCES_FRI },
      voiceSamplesByDay: {
        mon: VOICE_SAMPLES_MON,
        wed: VOICE_SAMPLES_WED,
        fri: VOICE_SAMPLES_FRI,
      },
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(peakInFlight).toBe(3);
    expect(out.results).toHaveLength(3);
    expect(out.results.map((r) => r.day).sort()).toEqual(['fri', 'mon', 'wed']);
    // silence unused-var lints for releaseSignal (kept for readability)
    void releaseSignal;
  });
});

// ---------- 4. missing day throws ----------
describe('runDrafter — angle validation', () => {
  it('throws when a day is missing', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: draftPayloadFor(ANGLE_MON) });
    await expect(
      runDrafter({
        client,
        brand,
        angles: [ANGLE_MON, ANGLE_WED],
        sourcesByDay: { mon: SOURCES_MON, wed: SOURCES_WED, fri: [] },
        voiceSamplesByDay: { mon: VOICE_SAMPLES_MON, wed: VOICE_SAMPLES_WED, fri: [] },
      }),
    ).rejects.toThrow(/expected 3 angles|fri/);
  });

  it('throws on duplicate days', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: draftPayloadFor(ANGLE_MON) });
    await expect(
      runDrafter({
        client,
        brand,
        angles: [ANGLE_MON, ANGLE_MON, ANGLE_FRI],
        sourcesByDay: { mon: SOURCES_MON, wed: SOURCES_WED, fri: SOURCES_FRI },
        voiceSamplesByDay: {
          mon: VOICE_SAMPLES_MON,
          wed: VOICE_SAMPLES_WED,
          fri: VOICE_SAMPLES_FRI,
        },
      }),
    ).rejects.toThrow(/duplicate/);
  });
});

// ---------- 5. cost aggregation ----------
describe('runDrafter — cost aggregation', () => {
  it('sums cost_usd across all 3 parallel calls', async () => {
    const brand = getBrand();
    // 3 distinct usage shapes. Sonnet 4.6: $3/M input, $15/M output.
    // call 1: 1000 in, 500 out  -> 0.003 + 0.0075 = 0.0105
    // call 2: 2000 in, 600 out  -> 0.006 + 0.009  = 0.015
    // call 3: 800  in, 400 out  -> 0.0024 + 0.006 = 0.0084
    // total = 0.0339
    const create = vi.fn(async (input: any) => {
      const userMsg: string = input.messages[0].content;
      let pillar = 'shipped';
      let usage = { input_tokens: 1000, output_tokens: 500 };
      let angle = ANGLE_MON;
      if (userMsg.includes('framework')) {
        pillar = 'framework';
        usage = { input_tokens: 2000, output_tokens: 600 };
        angle = ANGLE_WED;
      } else if (userMsg.includes('critique')) {
        pillar = 'critique';
        usage = { input_tokens: 800, output_tokens: 400 };
        angle = ANGLE_FRI;
      }
      void pillar;
      return {
        content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(angle)) }],
        usage,
      };
    });
    const client = { messages: { create } } as any;

    const out = await runDrafter({
      client,
      brand,
      angles: [ANGLE_MON, ANGLE_WED, ANGLE_FRI],
      sourcesByDay: { mon: SOURCES_MON, wed: SOURCES_WED, fri: SOURCES_FRI },
      voiceSamplesByDay: {
        mon: VOICE_SAMPLES_MON,
        wed: VOICE_SAMPLES_WED,
        fri: VOICE_SAMPLES_FRI,
      },
    });

    expect(out.cost_usd).toBeCloseTo(0.0339, 4);
    // And the aggregate must equal the sum of per-draft costs.
    const perCallSum = out.results.reduce((s, r) => s + r.draft.cost_usd, 0);
    expect(out.cost_usd).toBeCloseTo(perCallSum, 6);
  });
});

// ---------- 6. brand-driven config ----------
describe('runDrafter — brand-driven config', () => {
  it('passes brand.agents.drafter.{model,max_tokens} to client.messages.create', async () => {
    const brand = getBrand();
    const captured: any[] = [];
    const create = vi.fn(async (input: any) => {
      captured.push(input);
      const userMsg: string = input.messages[0].content;
      const angle = userMsg.includes('framework')
        ? ANGLE_WED
        : userMsg.includes('critique')
        ? ANGLE_FRI
        : ANGLE_MON;
      return {
        content: [{ type: 'text', text: JSON.stringify(draftPayloadFor(angle)) }],
        usage: { input_tokens: 500, output_tokens: 400 },
      };
    });
    const client = { messages: { create } } as any;

    await runDrafter({
      client,
      brand,
      angles: [ANGLE_MON, ANGLE_WED, ANGLE_FRI],
      sourcesByDay: { mon: SOURCES_MON, wed: SOURCES_WED, fri: SOURCES_FRI },
      voiceSamplesByDay: {
        mon: VOICE_SAMPLES_MON,
        wed: VOICE_SAMPLES_WED,
        fri: VOICE_SAMPLES_FRI,
      },
    });

    expect(captured).toHaveLength(3);
    for (const c of captured) {
      expect(c.model).toBe(brand.agents.drafter.model);
      expect(c.max_tokens).toBe(brand.agents.drafter.max_tokens);
    }
  });
});

// ---------- 7. pillar mismatch surfaces as DrafterSchemaError ----------
describe('runDrafterOnce — pillar contract', () => {
  it('throws DrafterSchemaError if LLM pillar != angle.pillar', async () => {
    const brand = getBrand();
    const bad = { ...draftPayloadFor(ANGLE_MON), pillar: 'framework' };
    const client = makeFakeClient({ payload: bad });
    await expect(
      runDrafterOnce({
        client,
        brand,
        angle: ANGLE_MON,
        sources: SOURCES_MON,
        voiceSamples: VOICE_SAMPLES_MON,
      }),
    ).rejects.toThrow(DrafterSchemaError);
  });
});
