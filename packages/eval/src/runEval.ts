import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";
import { runJudge } from "./judge.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

/** Find the most recent published drafts (newest week first), up to `n`. */
function recentDrafts(n: number): { id: string; body: string }[] {
  const draftsRoot = join(REPO_ROOT, "drafts");
  let weeks: string[];
  try {
    weeks = readdirSync(draftsRoot).filter((w) => /^\d{4}-W\d{2}$/.test(w)).sort().reverse();
  } catch {
    return [];
  }
  const out: { id: string; body: string }[] = [];
  for (const week of weeks) {
    for (const f of readdirSync(join(draftsRoot, week))) {
      if (f.endsWith(".md") && !f.includes("SKIPPED")) {
        out.push({ id: `${week}/${f}`, body: readFileSync(join(draftsRoot, week, f), "utf8") });
        if (out.length >= n) return out;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const profileDir = process.argv.includes("--profile")
    ? process.argv[process.argv.indexOf("--profile") + 1]!
    : "examples/sai-voice";
  const profile = loadProfile(resolve(REPO_ROOT, profileDir));
  const goldenDir = join(profile.profilePath, profile.brand.judge.golden_dir);
  const model = profile.brand.agents.critic.model;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  const drafts = recentDrafts(3);
  if (drafts.length === 0) {
    console.log("no published drafts to judge");
    return;
  }

  const lines = ["| draft | score | reason |", "|---|---|---|"];
  for (const d of drafts) {
    const { result } = await runJudge({ client, model, draftText: d.body, goldenDir });
    lines.push(`| ${d.id} | ${result.score} | ${result.reason.replace(/\|/g, "/")} |`);
  }
  const table = lines.join("\n");
  console.log(table);

  // When run in CI, append to the GitHub step summary.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(summary, `## Judge scores (last ${drafts.length} drafts)\n\n${table}\n`);
  }
}

void main();
