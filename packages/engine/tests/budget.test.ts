import { describe, it, expect, vi } from "vitest";
import path from "node:path";

// Critic agent returns a fix-block verdict for every day so the graph retries.
vi.mock("../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => ({
    verdicts: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      verdict: "fix",
      severity: "block",
      reasons: ["needs work"],
      specific_fixes: ["tighten the hook"],
    })),
    cost_usd: 0.02,
  })),
}));

// Cheap scout/strategist/drafter mocks so the full graph can run for the
// per-day retries test without real API calls.
vi.mock("../src/agents/scout.js", () => ({
  runScout: vi.fn(async () => ({
    source: "web_search",
    trending_topics: [{ title: "t", url: "https://s.test/1", summary: "OpenAI shipped 40% faster inference" }],
    recent_launches: [],
    engagement_signals: [],
    cost_usd: 0.001,
  })),
}));
vi.mock("../src/agents/strategist.js", () => ({
  runStrategist: vi.fn(async () => ({
    angles: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      pillar: day === "mon" ? "shipped" : day === "wed" ? "framework" : "critique",
      sources: ["https://s.test/1"],
      one_line_angle: "a",
      hook_idea: "h",
      why_it_works: "w",
    })),
    cost_usd: 0.01,
  })),
}));
vi.mock("../src/agents/drafter.js", () => ({
  runDrafter: vi.fn(async () => ({
    results: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      draft: {
        post_text: "Shipped a thing this week\n\nIt went well and the team learned a lot from the work",
        pillar: day === "mon" ? "shipped" : day === "wed" ? "framework" : "critique",
        claims: [],
        angle_rationale: "",
        attempt: 0,
        cost_usd: 0,
      },
    })),
    cost_usd: 0.03,
  })),
}));
vi.mock("../src/gates/judge.js", () => ({
  runJudge: vi.fn(async () => ({ result: { score: 4, reason: "ok" }, cost_usd: 0 })),
}));

import { criticNode } from "../src/nodes/critic.node.js";
import { gateNode } from "../src/nodes/gate.node.js";
import { run } from "../src/run.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

// Minimal brand stub for unit-testing nodes directly (mirrors tests/nodes/*).
function brandStub(costCap: number, wallTimeSeconds = 180) {
  return {
    agents: { critic: { model: "claude-sonnet-4-6" } },
    budgets: { cost_usd_per_run: costCap, wall_time_seconds: wallTimeSeconds },
  };
}

describe("budget cost cap", () => {
  it("aborts when projected cost exceeds the cap", async () => {
    // costUsd already at 0.39; the mocked critic adds 0.02 -> 0.41 > 0.40 cap.
    const state = {
      profile: { brand: brandStub(0.4) },
      costUsd: 0.39,
      startedAt: 0,
      drafts: {
        mon: { post_text: "x", pillar: "shipped", claims: [] },
        wed: { post_text: "y", pillar: "framework", claims: [] },
        fri: { post_text: "z", pillar: "critique", claims: [] },
      },
      verdicts: { mon: undefined, wed: undefined, fri: undefined },
    } as never;

    const patch = await criticNode(state);
    expect(patch.aborted).toBe(true);
    expect(patch.abortReason).toBe("cost-cap-exceeded");
    // Cost is still folded in even though the run aborts.
    expect(patch.costUsd).toBeCloseTo(0.02);
  });

  it("does not abort when projected cost stays within the cap", async () => {
    const state = {
      profile: { brand: brandStub(0.4) },
      costUsd: 0.1,
      startedAt: 0,
      drafts: {
        mon: { post_text: "x", pillar: "shipped", claims: [] },
        wed: { post_text: "y", pillar: "framework", claims: [] },
        fri: { post_text: "z", pillar: "critique", claims: [] },
      },
      verdicts: { mon: undefined, wed: undefined, fri: undefined },
    } as never;

    const patch = await criticNode(state);
    expect(patch.aborted).toBeUndefined();
    expect(patch.costUsd).toBeCloseTo(0.02);
  });
});

describe("budget wall-time cap", () => {
  it("aborts when wall time is exceeded", async () => {
    // startedAt far in the past with a 1-second wall-time -> exceeded.
    const state = {
      profile: { brand: brandStub(10, 1) },
      costUsd: 0,
      startedAt: Date.now() - 5000,
      drafts: {
        mon: { post_text: "x", pillar: "shipped", claims: [] },
        wed: { post_text: "y", pillar: "framework", claims: [] },
        fri: { post_text: "z", pillar: "critique", claims: [] },
      },
      verdicts: { mon: undefined, wed: undefined, fri: undefined },
    } as never;

    const patch = await criticNode(state);
    expect(patch.aborted).toBe(true);
    expect(patch.abortReason).toBe("wall-time-exceeded");
  });

  it("startedAt === 0 disables the wall-time check", async () => {
    const state = {
      profile: { brand: brandStub(10, 1) },
      costUsd: 0,
      startedAt: 0,
      drafts: {
        mon: { post_text: "x", pillar: "shipped", claims: [] },
        wed: { post_text: "y", pillar: "framework", claims: [] },
        fri: { post_text: "z", pillar: "critique", claims: [] },
      },
      verdicts: { mon: undefined, wed: undefined, fri: undefined },
    } as never;

    const patch = await criticNode(state);
    expect(patch.aborted).toBeUndefined();
  });
});

describe("gateNode aborted run", () => {
  it("marks all three days skipped with reasonClass 'aborted'", async () => {
    const state = {
      profile: { brand: brandStub(0.4) },
      aborted: true,
      abortReason: "cost-cap-exceeded",
      drafts: { mon: undefined, wed: undefined, fri: undefined },
      verdicts: { mon: undefined, wed: undefined, fri: undefined },
      retries: { mon: 1, wed: 0, fri: 0 },
      sources: [],
    } as never;

    const patch = await gateNode(state);
    expect(patch.days).toHaveLength(3);
    for (const day of ["mon", "wed", "fri"] as const) {
      const outcome = patch.days!.find((d) => d.day === day)!;
      expect(outcome.status).toBe("skipped");
      expect(outcome.reasonClass).toBe("aborted");
      expect(outcome.reason).toBe("cost-cap-exceeded");
    }
    // Per-day retries carry through to the aborted outcome.
    expect(patch.days!.find((d) => d.day === "mon")!.retries).toBe(1);
  });
});

describe("per-day retries counter", () => {
  it("increments retries[day] once per redraft for each fix-block day", async () => {
    // sai-voice has max_retry_loops: 2, so a perpetually fix-block run
    // redrafts twice; each day's retries should land at 2 by the gate.
    const res = await run({ profileDir: path.join(REPO_ROOT, "examples/sai-voice"), dryRun: true });
    expect(res.days).toHaveLength(3);
    for (const day of ["mon", "wed", "fri"] as const) {
      const outcome = res.days.find((d) => d.day === day)!;
      expect(outcome.status).toBe("skipped");
      expect(outcome.reasonClass).toBe("critic_block");
      expect(outcome.retries).toBe(2);
    }
  });
});
