import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { complete, resolveModelId } from "../lib/llm.js";

export const JudgeResultSchema = z.object({
  score: z.number().min(1).max(5),
  reason: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

/** Load up to `max` golden exemplars (markdown bodies) from a corpus dir. */
export function loadCorpus(goldenDir: string, max = 8): string[] {
  let files: string[];
  try {
    files = readdirSync(goldenDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  } catch {
    return [];
  }
  return files.slice(0, max).map((f) => readFileSync(path.join(goldenDir, f), "utf8"));
}

export interface RunJudgeParams {
  client: Anthropic;
  /** brand-config model id or alias, e.g. "claude-sonnet-4-6". */
  model: string;
  draftText: string;
  goldenDir: string;
}

/**
 * Score a draft 1 to 5 against the golden corpus. One Sonnet call. Returns the
 * parsed verdict and the call cost. Throws if the model returns unparseable JSON.
 */
export async function runJudge(
  p: RunJudgeParams,
): Promise<{ result: JudgeResult; cost_usd: number }> {
  const corpus = loadCorpus(p.goldenDir);
  const system = [
    "You are a strict editor scoring a LinkedIn draft against a corpus of the",
    "author's best past posts. Score 1 to 5 on voice fidelity and quality:",
    "5 = indistinguishable from the author's best, 1 = generic AI slop.",
    'Return JSON only: { "score": <1-5>, "reason": "<one sentence>" }.',
  ].join("\n");
  const user = [
    "AUTHOR'S BEST POSTS (the bar):",
    ...corpus.map((c, i) => `--- exemplar ${i + 1} ---\n${c}`),
    "",
    "DRAFT TO SCORE:",
    p.draftText,
  ].join("\n");

  const res = await complete({
    client: p.client,
    model: resolveModelId(p.model),
    system,
    user,
    maxTokens: 300,
    temperature: 0.2,
  });

  const cleaned = res.text.trim().replace(/^```json\s*|\s*```$/g, "");
  const result = JudgeResultSchema.parse(JSON.parse(cleaned));
  return { result, cost_usd: res.cost_usd };
}
