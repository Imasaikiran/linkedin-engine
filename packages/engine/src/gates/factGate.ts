import { runHallucinationGate } from "../lib/gate.js";
import type { Claim, ClaimVerdict } from "../lib/schema.js";

export interface FactGateInput {
  claims: Claim[];
  sources: { url: string; body: string }[];
}
export interface FactGateResult {
  /** true unless a factual claim is uncited or cites a non-scouted URL. */
  pass: boolean;
  /** Full per-claim verdicts from the v1 matcher, kept for audit/logging. */
  verdicts: ClaimVerdict[];
  /** The reasons that actually block (drive the skip). Empty when pass. */
  hardFails: string[];
}

/**
 * Deterministic fact gate. It blocks only on signals it can verify reliably and
 * deterministically:
 *
 *   1. a non-opinion (factual) claim with no source_url, and
 *   2. a non-opinion claim whose source_url was not actually scouted.
 *
 * Both indicate an uncited or fabricated citation, which is the trust-killer the
 * gate exists to stop. It deliberately does NOT block on content matching
 * (does the digit/quote/name appear in the source body): scout sources are short
 * summaries, not full articles, and the drafter's claim typing is noisy, so
 * content checks produce false positives. Those checks still run and are returned
 * in `verdicts` for human audit; factual accuracy is the critic's and the
 * reviewer's job, per the PRD risk register. Opinions are the author's own voice
 * (often their own first-person metrics) and are never required to cite a source.
 */
export function runFactGate(input: FactGateInput): FactGateResult {
  const scoutedUrls = new Set(input.sources.map((s) => s.url));
  const hardFails: string[] = [];

  for (const claim of input.claims) {
    if (claim.type === "opinion") continue;
    const snippet = claim.claim_text.slice(0, 60);
    if (!claim.source_url) {
      hardFails.push(`unsourced ${claim.type} claim: "${snippet}"`);
      continue;
    }
    if (!scoutedUrls.has(claim.source_url)) {
      hardFails.push(`fabricated citation: ${claim.source_url} was not scouted ("${snippet}")`);
    }
  }

  // Keep the rich v1 verdicts for audit/logging (not used for the block decision).
  const { verdicts } = runHallucinationGate({
    claims: input.claims,
    sources: input.sources,
    voiceCorpusUrls: [],
  });

  return { pass: hardFails.length === 0, verdicts, hardFails };
}
