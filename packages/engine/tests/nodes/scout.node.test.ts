import { describe, it, expect, vi } from "vitest";
import path from "node:path";

vi.mock("../../src/agents/scout.js", () => ({
  runScout: vi.fn(async () => ({
    source: "web_search",
    trending_topics: [{ title: "t1", url: "https://a.test/1", summary: "s1" }],
    recent_launches: [{ title: "t2", url: "https://b.test/2", summary: "s2" }],
    engagement_signals: [],
    cost_usd: 0.01,
  })),
}));

import { scoutNode } from "../../src/nodes/scout.node.js";
import { loadProfile } from "../../src/lib/profile.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

describe("scoutNode", () => {
  it("returns a patch with sources, scout, and summed cost", async () => {
    const p = loadProfile(path.join(REPO_ROOT, "examples/sai-voice"));
    const patch = await scoutNode({
      profile: { name: "examples/sai-voice", path: p.profilePath, brand: p.brand, voiceCorpusDir: p.voiceCorpusDir },
    } as never);
    expect(patch.costUsd).toBeCloseTo(0.01);
    expect(patch.sources!.map((s) => s.url)).toContain("https://a.test/1");
    expect(patch.scout).toBeDefined();
  });
});
