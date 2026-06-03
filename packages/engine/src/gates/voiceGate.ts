import { runVoiceGate } from "../lib/gate.js";
import type { Brand } from "../lib/brand.js";

export interface VoiceGateOutcome {
  /** true when the gate is satisfied OR the gate is in log_only mode. */
  pass: boolean;
  /** the raw deterministic failures, recorded even in log_only mode. */
  failures: string[];
  /** true when failures existed but were not enforced (log_only). */
  loggedOnly: boolean;
}

/**
 * Wrap the v1 voice gate. In log_only mode (the first 48h per DESIGN), failures
 * are recorded but never block. In blocking mode, failures skip the day.
 */
export function runVoiceGateWrapped(
  post: string,
  opts: { brand: Brand; pillar: string; mode: "blocking" | "log_only" },
): VoiceGateOutcome {
  const { pass, failures } = runVoiceGate(post, { brand: opts.brand, pillar: opts.pillar });
  if (opts.mode === "log_only" && !pass) {
    return { pass: true, failures, loggedOnly: true };
  }
  return { pass, failures, loggedOnly: false };
}
