import { describe, it, expect, vi } from "vitest";
import path from "node:path";

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
    angles: [
      { day: "mon", pillar: "shipped", sources: ["https://s.test/1"], one_line_angle: "a", hook_idea: "h", why_it_works: "w" },
      { day: "wed", pillar: "framework", sources: ["https://s.test/1"], one_line_angle: "a", hook_idea: "h", why_it_works: "w" },
      { day: "fri", pillar: "critique", sources: ["https://s.test/1"], one_line_angle: "a", hook_idea: "h", why_it_works: "w" },
    ],
    cost_usd: 0.01,
  })),
}));
vi.mock("../src/agents/drafter.js", () => ({
  runDrafter: vi.fn(async () => ({
    results: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      draft: {
        post_text: "Shipped a thing this week\n\nIt went well and the team learned a lot from the work we did",
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
vi.mock("../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => ({
    verdicts: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      verdict: "approve",
      severity: "soft",
      reasons: [],
      specific_fixes: [],
    })),
    cost_usd: 0.02,
  })),
}));
vi.mock("../src/gates/judge.js", () => ({
  runJudge: vi.fn(async () => ({ result: { score: 4, reason: "ok" }, cost_usd: 0 })),
}));

import { run } from "../src/run.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

describe("graph run (mocked agents)", () => {
  it("runs scout -> strategist -> draft -> critic -> gate and returns 3 outcomes", async () => {
    const res = await run({ profileDir: path.join(REPO_ROOT, "examples/sai-voice"), dryRun: true });
    expect(res.days).toHaveLength(3);
    expect(res.costUsd).toBeCloseTo(0.001 + 0.01 + 0.03 + 0.02, 3);
    expect(res.aborted).toBe(false);
  });
});
