import { describe, it, expect, vi } from "vitest";
import path from "node:path";

vi.mock("../../src/lib/llm.js", () => ({
  complete: vi.fn(async () => ({
    text: '{"score": 4, "reason": "on voice, concrete, no slop"}',
    inputTokens: 100,
    outputTokens: 20,
    cost_usd: 0.004,
  })),
  resolveModelId: (m: string) => m,
}));

import { runJudge, loadCorpus } from "../../src/gates/judge.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const GOLDEN = path.join(REPO_ROOT, "examples/sai-voice/golden");

describe("runJudge", () => {
  it("returns the parsed score, reason, and call cost", async () => {
    const { result, cost_usd } = await runJudge({
      client: {} as never,
      model: "claude-sonnet-4-6",
      draftText: "Shipped a thing this week. It went well.",
      goldenDir: GOLDEN,
    });
    expect(result.score).toBe(4);
    expect(result.reason).toContain("voice");
    expect(cost_usd).toBeCloseTo(0.004);
  });
});

describe("loadCorpus", () => {
  it("reads markdown exemplars and skips README", () => {
    const corpus = loadCorpus(GOLDEN, 3);
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for a missing dir", () => {
    expect(loadCorpus(path.join(REPO_ROOT, "examples/nope/golden"))).toEqual([]);
  });
});
