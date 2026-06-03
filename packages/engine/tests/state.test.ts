import { describe, it, expect } from "vitest";
import { GraphAnnotation, type GraphStateValue } from "../src/state.js";

describe("GraphAnnotation", () => {
  it("has a channel for every engine field", () => {
    const channels = Object.keys(GraphAnnotation.spec);
    for (const key of [
      "runId", "week", "dryRun", "profile", "scout", "sources", "angles",
      "drafts", "verdicts", "retries", "retryPass", "costUsd", "days",
      "aborted", "abortReason",
    ]) {
      expect(channels).toContain(key);
    }
  });

  it("a partial typed value compiles and reads back", () => {
    const v: Partial<GraphStateValue> = {
      runId: "r1",
      costUsd: 0,
      days: [{ day: "mon", status: "published", retries: 0 }],
    };
    expect(v.runId).toBe("r1");
    expect(v.days?.[0]?.day).toBe("mon");
  });
});
