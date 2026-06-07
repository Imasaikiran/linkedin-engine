import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runStrategist,
  StrategistSchemaError,
  StrategistOutputSchema,
} from '../../src/agents/strategist.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';
import type { ScoutOutput } from '../../src/agents/scout.js';
import type { ScoredCluster } from '../../src/lib/schema.js';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- fixtures ----------
const SCOUT_FIXTURE: ScoutOutput = {
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
    {
      title: 'DeepMind releases Gemini eval harness',
      url: 'https://deepmind.google/blog/gemini-evals',
      summary: 'New harness covers multimodal regression cases.',
    },
  ],
  recent_launches: [
    {
      title: 'Claude 4.7 launch',
      url: 'https://www.anthropic.com/news/claude-4-7',
      summary: 'Claude 4.7 ships with improved tool use.',
    },
    {
      title: 'Cursor 2.0 ships agent mode',
      url: 'https://cursor.com/blog/2-0',
      summary: 'Cursor 2.0 adds long-running agent mode.',
    },
  ],
  engagement_signals: [
    'Posts about agent eval get 3x engagement this week',
  ],
  cost_usd: 0.012,
  source: 'web_search',
};

const CLUSTERS_FIXTURE: ScoredCluster[] = [
  {
    topic: 'agent-eval-frameworks',
    items: [
      {
        url: 'https://anthropic.test/eval-post',
        title: 'Eval frameworks compared',
        body: 'body',
        published_at: '2026-04-12T00:00:00.000Z',
        source: 'anthropic',
      },
    ],
    earliest_date: '2026-04-12T00:00:00.000Z',
    source_count: 3,
    novelty: 0.7,
    authority: 0.8,
    confirmation: 0.6,
    controversy: 0.5,
    final_score: 0.72,
  },
  {
    topic: 'long-context-routing',
    items: [
      {
        url: 'https://openai.test/routing-post',
        title: 'Long context routing notes',
        body: 'body',
        published_at: '2026-04-10T00:00:00.000Z',
        source: 'openai',
      },
    ],
    earliest_date: '2026-04-10T00:00:00.000Z',
    source_count: 2,
    novelty: 0.6,
    authority: 0.7,
    confirmation: 0.5,
    controversy: 0.4,
    final_score: 0.55,
  },
];

// Canned valid LLM JSON, one angle per day, pillars matching brand defaults.
const VALID_LLM_PAYLOAD = {
  angles: [
    {
      day: 'mon',
      pillar: 'shipped',
      hook_idea: 'Shipped Agent SDK 1.0 in 6 weeks. One number changed everything.',
      why_it_works: 'The target audience cares about shipping cadence with specific numbers; the Anthropic launch is fresh and audience-coded.',
      sources: ['https://www.anthropic.com/news/agent-sdk'],
      cluster_topic: 'agent-eval-frameworks',
    },
    {
      day: 'wed',
      pillar: 'framework',
      hook_idea: '3 reasons your agent eval harness misses the only metric that matters',
      why_it_works: 'Save-worthy framework targeting eng leads building eval pipelines at frontier labs.',
      sources: ['https://anthropic.test/eval-post'],
      cluster_topic: 'agent-eval-frameworks',
    },
    {
      day: 'fri',
      pillar: 'critique',
      hook_idea: 'OpenAI is wrong about deprecating assistants. Here is why.',
      why_it_works: 'Contrarian-but-charitable take on a named, recent launch with debate hooks for AI PMs.',
      sources: ['https://openai.com/blog/responses-api'],
    },
  ],
};

// ---------- helpers ----------
function makeFakeClient(opts: {
  payload?: unknown;
  text?: string;
  capture?: (input: any) => void;
  usage?: { input_tokens: number; output_tokens: number };
} = {}) {
  const create = vi.fn(async (input: any) => {
    opts.capture?.(input);
    const text = opts.text ?? JSON.stringify(opts.payload ?? VALID_LLM_PAYLOAD);
    return {
      content: [{ type: 'text', text }],
      usage: opts.usage ?? { input_tokens: 600, output_tokens: 400 },
    };
  });
  return { messages: { create } } as any;
}

function getBrand(): Brand {
  return loadBrand('../../examples/sai-voice/brand.yaml');
}

// ---------- snapshot test ----------
describe('runStrategist — fixture snapshot', () => {
  it('returns the expected StrategistOutput for a canned LLM response', async () => {
    const brand = getBrand();
    const client = makeFakeClient();
    const out = await runStrategist({
      client,
      brand,
      scout: SCOUT_FIXTURE,
      clusters: CLUSTERS_FIXTURE,
      recentAngles: [],
    });

    // Schema round-trip
    const v = StrategistOutputSchema.safeParse(out);
    expect(v.success).toBe(true);

    // Inline equality assertion (snapshot embedded so the test is self-contained).
    expect(out.angles).toEqual([
      {
        day: 'mon',
        pillar: 'shipped',
        hook_idea: 'Shipped Agent SDK 1.0 in 6 weeks. One number changed everything.',
        why_it_works: 'The target audience cares about shipping cadence with specific numbers; the Anthropic launch is fresh and audience-coded.',
        sources: ['https://www.anthropic.com/news/agent-sdk'],
        cluster_topic: 'agent-eval-frameworks',
      },
      {
        day: 'wed',
        pillar: 'framework',
        hook_idea: '3 reasons your agent eval harness misses the only metric that matters',
        why_it_works: 'Save-worthy framework targeting eng leads building eval pipelines at frontier labs.',
        sources: ['https://anthropic.test/eval-post'],
        cluster_topic: 'agent-eval-frameworks',
      },
      {
        day: 'fri',
        pillar: 'critique',
        hook_idea: 'OpenAI is wrong about deprecating assistants. Here is why.',
        why_it_works: 'Contrarian-but-charitable take on a named, recent launch with debate hooks for AI PMs.',
        sources: ['https://openai.com/blog/responses-api'],
        cluster_topic: undefined,
      },
    ]);
    expect(out.cost_usd).toBeGreaterThan(0);
  });
});

// ---------- pillar enforcement ----------
describe('runStrategist — pillar consistency', () => {
  it('throws StrategistSchemaError when an angle pillar does not match brand.cadence', async () => {
    const brand = getBrand();
    const bad = {
      angles: [
        { ...VALID_LLM_PAYLOAD.angles[0], pillar: 'framework' }, // mon pillar should be "shipped"
        VALID_LLM_PAYLOAD.angles[1],
        VALID_LLM_PAYLOAD.angles[2],
      ],
    };
    const client = makeFakeClient({ payload: bad });
    await expect(
      runStrategist({
        client,
        brand,
        scout: SCOUT_FIXTURE,
        clusters: CLUSTERS_FIXTURE,
      }),
    ).rejects.toThrow(StrategistSchemaError);

    // Re-run to assert the message wording (separate call because a thrown error stops the await).
    const client2 = makeFakeClient({ payload: bad });
    await expect(
      runStrategist({
        client: client2,
        brand,
        scout: SCOUT_FIXTURE,
        clusters: CLUSTERS_FIXTURE,
      }),
    ).rejects.toThrow(/strategist.*pillar/i);
  });
});

// ---------- malformed JSON ----------
describe('runStrategist — schema rejection', () => {
  it('throws when LLM returns prose only', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ text: 'I do not feel like producing JSON today.' });
    await expect(
      runStrategist({
        client,
        brand,
        scout: SCOUT_FIXTURE,
        clusters: CLUSTERS_FIXTURE,
      }),
    ).rejects.toThrow(/strategist/);
  });

  it('throws StrategistSchemaError on wrong-shape JSON', async () => {
    const brand = getBrand();
    const client = makeFakeClient({ payload: { angles: 'not an array' } });
    await expect(
      runStrategist({
        client,
        brand,
        scout: SCOUT_FIXTURE,
        clusters: CLUSTERS_FIXTURE,
      }),
    ).rejects.toThrow(StrategistSchemaError);
  });
});

// ---------- cost computation ----------
describe('runStrategist — cost', () => {
  it('reports cost_usd > 0 in expected ballpark for sonnet pricing', async () => {
    const brand = getBrand();
    // Sonnet 4.6 pricing: $3/M input, $15/M output.
    // 1000 input + 800 output → 0.000003*1000 + 0.000015*800 = 0.003 + 0.012 = 0.015.
    const client = makeFakeClient({
      usage: { input_tokens: 1000, output_tokens: 800 },
    });
    const out = await runStrategist({
      client,
      brand,
      scout: SCOUT_FIXTURE,
      clusters: CLUSTERS_FIXTURE,
    });
    expect(out.cost_usd).toBeGreaterThan(0);
    expect(out.cost_usd).toBeCloseTo(0.015, 4);
  });
});

// ---------- brand-driven model + max_tokens ----------
describe('runStrategist — brand-driven config', () => {
  it('passes brand.agents.strategist.{model,max_tokens} to client.messages.create', async () => {
    const brand = getBrand();
    let captured: any = null;
    const client = makeFakeClient({ capture: (input) => { captured = input; } });
    await runStrategist({
      client,
      brand,
      scout: SCOUT_FIXTURE,
      clusters: CLUSTERS_FIXTURE,
    });
    expect(captured).not.toBeNull();
    // The complete() helper resolves the alias before calling the SDK.
    // brand.yaml ships "claude-sonnet-4-6" which is also the canonical id, so
    // they match exactly here.
    expect(captured.model).toBe(brand.agents.strategist.model);
    expect(captured.max_tokens).toBe(brand.agents.strategist.max_tokens);
  });
});

// ---------- recent-angles dedupe ----------
describe('runStrategist — recent angle dedupe surfaces in prompt', () => {
  it('includes RECENT_ANGLES topics in the user prompt when supplied', async () => {
    const brand = getBrand();
    let captured: any = null;
    const client = makeFakeClient({ capture: (input) => { captured = input; } });
    const recent = [
      { day: 'mon', cluster_topic: 'agent-eval-frameworks', hook_idea: 'last week eval harness post' },
      { day: 'wed', cluster_topic: 'long-context-routing', hook_idea: 'routing tradeoffs post' },
    ];
    await runStrategist({
      client,
      brand,
      scout: SCOUT_FIXTURE,
      clusters: CLUSTERS_FIXTURE,
      recentAngles: recent,
    });
    expect(captured).not.toBeNull();
    const userMsg = captured.messages[0].content as string;
    expect(userMsg).toContain('RECENT_ANGLES');
    expect(userMsg).toContain('do NOT repeat');
    expect(userMsg).toContain('agent-eval-frameworks');
    expect(userMsg).toContain('long-context-routing');
    expect(userMsg).toContain('last week eval harness post');
  });
});
