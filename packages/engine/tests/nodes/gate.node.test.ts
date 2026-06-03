import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { loadProfile } from "../../src/lib/profile.js";

vi.mock("../../src/gates/judge.js", () => ({
  runJudge: vi.fn(async () => ({ result: { score: 2, reason: "weak" }, cost_usd: 0.005 })),
}));

import { gateNode } from "../../src/nodes/gate.node.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

function stateWith(judgeMode: "blocking" | "log_only") {
  const p = loadProfile(path.join(REPO_ROOT, "examples/sai-voice"));
  p.brand.judge.mode = judgeMode;
  p.brand.judge.threshold = 3.5;
  // voice + fact log_only so only the judge decides
  p.brand.gates.voice_mode = "log_only";
  p.brand.gates.fact_mode = "log_only";
  const approve = { verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] };
  const body = "Shipped a small thing this week\n\nIt taught the team one useful lesson about scope and focus";
  return {
    profile: { name: "x", path: p.profilePath, brand: p.brand, voiceCorpusDir: p.voiceCorpusDir },
    sources: [],
    drafts: {
      mon: { post_text: body, pillar: "shipped", claims: [] },
      wed: undefined,
      fri: undefined,
    },
    verdicts: { mon: approve, wed: undefined, fri: undefined },
    retries: { mon: 0, wed: 0, fri: 0 },
  } as never;
}

describe("gateNode judge", () => {
  it("skips a low-scoring draft in blocking mode", async () => {
    const patch = await gateNode(stateWith("blocking"));
    const mon = patch.days!.find((d) => d.day === "mon")!;
    expect(mon.status).toBe("skipped");
    expect(mon.reasonClass).toBe("judge_low");
  });

  it("publishes a low-scoring draft in log_only mode", async () => {
    const patch = await gateNode(stateWith("log_only"));
    const mon = patch.days!.find((d) => d.day === "mon")!;
    expect(mon.status).toBe("published");
  });
});
