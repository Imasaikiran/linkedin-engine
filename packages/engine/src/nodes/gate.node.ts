import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runFactGate } from "../gates/factGate.js";
import { runVoiceGateWrapped } from "../gates/voiceGate.js";
import { runJudge } from "../gates/judge.js";
import { observe } from "../lib/trace.js";
import { resolveModelId } from "../lib/llm.js";
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

  // Aborted run: skip every day with the abort reason and run no gates.
  if (state.aborted) {
    return {
      days: DAYS.map((day) => ({
        day,
        status: "skipped",
        reasonClass: "aborted",
        reason: state.abortReason,
        retries: state.retries[day] ?? 0,
      })),
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const judgeModel = resolveModelId(brand.agents.critic.model);
  const goldenDir = path.join(state.profile.path, brand.judge.golden_dir);
  let judgeCost = 0;

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
        reason: fact.hardFails.join("; "),
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

    // LLM judge: score against the golden corpus. log_only records the score;
    // blocking skips a draft below threshold. A judge error never blocks (best
    // effort) so a transient API issue cannot silently kill a good draft.
    let judgeScore: number | undefined;
    let judgeReason: string | undefined;
    try {
      const judged = await observe(`judge:${day}`, { model: judgeModel }, async () => {
        const r = await runJudge({ client, model: judgeModel, draftText: post, goldenDir });
        return {
          value: r,
          usage: { output: { score: r.result.score, reason: r.result.reason }, costUsd: r.cost_usd },
        };
      });
      judgeScore = judged.result.score;
      judgeReason = judged.result.reason;
      judgeCost += judged.cost_usd;
    } catch {
      // judge unavailable; treat as pass (log_only semantics)
    }

    if (
      judgeScore !== undefined &&
      brand.judge.mode === "blocking" &&
      judgeScore < brand.judge.threshold
    ) {
      outcomes.push({
        day,
        status: "skipped",
        reasonClass: "judge_low",
        reason: `judge ${judgeScore} < ${brand.judge.threshold}: ${judgeReason ?? ""}`,
        pillar,
        retries,
      });
      continue;
    }

    const wordCount = post.split(/\s+/).filter(Boolean).length;
    outcomes.push({ day, status: "published", pillar, retries, wordCount, charCount: post.length });
  }

  return { days: outcomes, costUsd: judgeCost };
}
