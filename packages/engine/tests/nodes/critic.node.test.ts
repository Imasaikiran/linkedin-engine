import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => ({
    verdicts: [
      { day: "mon", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
      { day: "wed", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
      { day: "fri", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
    ],
    cost_usd: 0.02,
  })),
}));

import { criticNode } from "../../src/nodes/critic.node.js";

const baseState = {
  profile: {
    brand: {
      agents: { critic: { model: "claude-sonnet-4-6" } },
      budgets: { cost_usd_per_run: 0.4, wall_time_seconds: 180 },
    },
  },
  costUsd: 0,
  startedAt: 0,
  drafts: {
    mon: { post_text: "x", pillar: "shipped", claims: [] },
    wed: { post_text: "y", pillar: "framework", claims: [] },
    fri: { post_text: "z", pillar: "critique", claims: [] },
  },
  verdicts: { mon: undefined, wed: undefined, fri: undefined },
} as never;

describe("criticNode", () => {
  it("records three verdicts and the critic cost", async () => {
    const patch = await criticNode(baseState);
    expect(Object.values(patch.verdicts!).every((v) => v!.verdict === "approve")).toBe(true);
    expect(patch.costUsd).toBeCloseTo(0.02);
  });
});
