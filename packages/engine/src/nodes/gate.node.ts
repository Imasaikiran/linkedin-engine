import { runFactGate } from "../gates/factGate.js";
import { runVoiceGateWrapped } from "../gates/voiceGate.js";
import { observe } from "../lib/trace.js";
import type { GraphStateValue, Day, DayOutcome } from "../state.js";
import type { Claim } from "../lib/schema.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

/** Strip em/en dashes mechanically before the voice gate sees the text (v1 behavior). */
function sanitize(text: string): string {
  return text.replace(/\s+[—–]\s+/g, ". ").replace(/[—–]/g, ", ");
}

export async function gateNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const brand = state.profile.brand;
  const outcomes: DayOutcome[] = [];

  for (const day of DAYS) {
    const draft = state.drafts[day] as
      | { post_text?: string; pillar?: string; claims?: Claim[] }
      | undefined;
    const verdict = state.verdicts[day];
    const retries = state.retries[day] ?? 0;

    if (!draft || !verdict || (verdict.verdict === "fix" && verdict.severity === "block")) {
      outcomes.push({ day, status: "skipped", reasonClass: "critic_block", retries });
      continue;
    }

    const post = sanitize(draft.post_text ?? "");
    const pillar = draft.pillar ?? "";

    const fact = await observe(`factGate:${day}`, { model: "deterministic" }, async () => {
      const r = runFactGate({ claims: draft.claims ?? [], sources: state.sources });
      return { value: r, usage: { output: { pass: r.pass } } };
    });
    if (!fact.pass && brand.gates.fact_mode === "blocking") {
      outcomes.push({
        day,
        status: "skipped",
        reasonClass: "fact_fail",
        reason: fact.verdicts.filter((v) => v.verdict !== "PASS").map((v) => v.reason).join("; "),
        pillar,
        retries,
      });
      continue;
    }

    const voice = await observe(`voiceGate:${day}`, { model: "deterministic" }, async () => {
      const r = runVoiceGateWrapped(post, { brand, pillar, mode: brand.gates.voice_mode });
      return { value: r, usage: { output: { pass: r.pass, loggedOnly: r.loggedOnly } } };
    });
    if (!voice.pass) {
      outcomes.push({
        day,
        status: "skipped",
        reasonClass: "voice_fail",
        reason: voice.failures.join("; "),
        pillar,
        retries,
      });
      continue;
    }

    const wordCount = post.split(/\s+/).filter(Boolean).length;
    outcomes.push({ day, status: "published", pillar, retries, wordCount, charCount: post.length });
  }

  return { days: outcomes };
}
