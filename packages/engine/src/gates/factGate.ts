import { runHallucinationGate } from "../lib/gate.js";
import type { Claim, ClaimVerdict } from "../lib/schema.js";

export interface FactGateInput {
  claims: Claim[];
  sources: { url: string; body: string }[];
}
export interface FactGateResult {
  pass: boolean;
  verdicts: ClaimVerdict[];
}

/**
 * Deterministic fact gate. Every non-opinion claim must cite a source_url that
 * exists in the scouted sources, and its content must map to that source body.
 * This is the v1 hallucination gate, now wired into the graph (closes the v1
 * TODO). Voice-corpus URLs are never valid sources here.
 */
export function runFactGate(input: FactGateInput): FactGateResult {
  const { pass, verdicts } = runHallucinationGate({
    claims: input.claims,
    sources: input.sources,
    voiceCorpusUrls: [],
  });
  return { pass, verdicts };
}
