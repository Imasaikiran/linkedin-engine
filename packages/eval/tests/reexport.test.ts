import { describe, it, expect } from "vitest";
import { runJudge, loadCorpus } from "../src/judge.js";

describe("eval package re-exports the engine judge", () => {
  it("exposes runJudge and loadCorpus", () => {
    expect(typeof runJudge).toBe("function");
    expect(typeof loadCorpus).toBe("function");
  });
});
