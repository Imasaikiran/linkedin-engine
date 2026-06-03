import { describe, it, expect } from "vitest";
import { runFactGate } from "../../src/gates/factGate.js";

const sources = [{ url: "https://real.test/a", body: "OpenAI shipped 40% faster inference." }];

describe("runFactGate", () => {
  it("passes a stat claim whose digits and URL are in the scouted sources", () => {
    const r = runFactGate({
      claims: [{ claim_text: "40% faster inference", type: "stat", source_url: "https://real.test/a", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(true);
  });

  it("fails a claim whose source_url was never scouted", () => {
    const r = runFactGate({
      claims: [{ claim_text: "90% faster", type: "stat", source_url: "https://fabricated.test/x", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(false);
  });
});
