import { describe, it, expect } from "vitest";
import { runFactGate } from "../../src/gates/factGate.js";
import type { Claim } from "../../src/lib/schema.js";

const sources = [
  { url: "https://real.test/a", body: "OpenAI shipped 40% faster inference." },
  { url: "https://real.test/b", body: "Anthropic filed an S-1 prospectus this week." },
];

describe("runFactGate blocking criteria", () => {
  it("passes a factual claim that cites a scouted source", () => {
    const r = runFactGate({
      claims: [{ claim_text: "40% faster inference", type: "stat", source_url: "https://real.test/a", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(true);
    expect(r.hardFails).toHaveLength(0);
  });

  it("BLOCKS a factual claim whose source_url was never scouted (fabricated citation)", () => {
    const r = runFactGate({
      claims: [{ claim_text: "90% faster", type: "stat", source_url: "https://fabricated.test/x", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(false);
    expect(r.hardFails.join(" ")).toMatch(/not scouted|fabricat/i);
  });

  it("does NOT block an opinion that contains a number (the author's own first-person metric)", () => {
    const r = runFactGate({
      claims: [
        { claim_text: "Adding a verification layer cost 11% more latency but caught cascading failures", type: "opinion", confidence: 0.8 },
      ] as Claim[],
      sources,
    });
    expect(r.pass).toBe(true);
  });

  it("does NOT block a non-opinion claim mis-typed as stat when it cites a scouted source", () => {
    const r = runFactGate({
      claims: [{ claim_text: "AI PMs increasingly design agentic systems", type: "stat", source_url: "https://real.test/b", confidence: 0.7 }],
      sources,
    });
    expect(r.pass).toBe(true);
  });

  it("does NOT block an attribution whose exact name is absent from a thin summary but cites a scouted source", () => {
    const r = runFactGate({
      claims: [{ claim_text: "OpenAI Frontier treats memory as first-class", type: "attribution", source_url: "https://real.test/a", confidence: 0.7 }],
      sources,
    });
    expect(r.pass).toBe(true);
  });

  it("BLOCKS a non-opinion claim with no source_url at all", () => {
    const r = runFactGate({
      claims: [{ claim_text: "Revenue grew 200% last quarter", type: "stat", confidence: 0.9 } as Claim],
      sources,
    });
    expect(r.pass).toBe(false);
    expect(r.hardFails.join(" ")).toMatch(/unsourced|no source/i);
  });

  it("passes a realistic mixed draft where every factual claim cites a scouted source", () => {
    const claims: Claim[] = [
      { claim_text: "Claude Opus 4.8 ships a 1M token context default", type: "capability", source_url: "https://real.test/a", confidence: 0.8 },
      { claim_text: "outputs are 95% reliable and 5% unreliable", type: "stat", source_url: "https://real.test/a", confidence: 0.8 },
      { claim_text: "Anthropic filed an S-1", type: "attribution", source_url: "https://real.test/b", confidence: 0.8 },
      { claim_text: "Agentic architecture is the defining shift of 2026", type: "opinion", confidence: 0.6 },
      { claim_text: "failure surfaces are multiplicative across agents", type: "opinion", confidence: 0.6 },
    ];
    const r = runFactGate({ claims, sources });
    expect(r.pass).toBe(true);
  });

  it("still returns rich per-claim verdicts for audit even when it does not block", () => {
    const r = runFactGate({
      claims: [{ claim_text: "AI PMs design agentic systems", type: "stat", source_url: "https://real.test/b", confidence: 0.7 }],
      sources,
    });
    expect(r.verdicts.length).toBe(1);
  });
});
