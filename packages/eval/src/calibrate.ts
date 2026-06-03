import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";
import { runJudge } from "./judge.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

/**
 * Leave-one-out calibration. For each golden post, score it using the OTHER
 * golden posts as the exemplar bar (so a post is never compared against itself).
 * Good posts should score at or above the threshold; if they do, blocking mode
 * is safe (it will not reject the author's own approved work).
 */
async function main(): Promise<void> {
  const profileDir = process.argv.includes("--profile")
    ? process.argv[process.argv.indexOf("--profile") + 1]!
    : "examples/sai-voice";
  const profile = loadProfile(resolve(REPO_ROOT, profileDir));
  const goldenDir = join(profile.profilePath, profile.brand.judge.golden_dir);
  const model = profile.brand.agents.critic.model;
  const threshold = profile.brand.judge.threshold;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  const files = readdirSync(goldenDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  if (files.length < 3) {
    console.log("need at least 3 golden posts to calibrate");
    return;
  }

  const scores: { file: string; score: number; reason: string }[] = [];
  for (const target of files) {
    // Build a temp corpus of every golden post EXCEPT the target.
    const tmp = mkdtempSync(join(tmpdir(), "golden-loo-"));
    try {
      for (const f of files) {
        if (f !== target) copyFileSync(join(goldenDir, f), join(tmp, f));
      }
      const body = readFileSync(join(goldenDir, target), "utf8");
      const { result } = await runJudge({ client, model, draftText: body, goldenDir: tmp });
      scores.push({ file: target, score: result.score, reason: result.reason });
      console.log(`  ${target}: ${result.score}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const vals = scores.map((s) => s.score).sort((a, b) => a - b);
  const n = vals.length;
  const median = n % 2 ? vals[(n - 1) / 2]! : (vals[n / 2 - 1]! + vals[n / 2]!) / 2;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const min = vals[0]!;
  const belowThreshold = scores.filter((s) => s.score < threshold).length;

  const report = [
    "# Judge calibration (leave-one-out over the golden corpus)",
    "",
    `Threshold: ${threshold}`,
    `Posts scored: ${n}`,
    `Min: ${min}  Median: ${median}  Mean: ${mean.toFixed(2)}`,
    `Golden posts that would be REJECTED at this threshold: ${belowThreshold} of ${n}`,
    "",
    "| post | score | reason |",
    "|---|---|---|",
    ...scores.map((s) => `| ${s.file} | ${s.score} | ${s.reason.replace(/\|/g, "/")} |`),
    "",
    belowThreshold === 0
      ? `RECOMMENDATION: safe to flip judge.mode and the gates to blocking. No approved post is rejected at threshold ${threshold}.`
      : `RECOMMENDATION: keep log_only OR lower the threshold. ${belowThreshold} approved post(s) would be wrongly rejected at ${threshold}.`,
  ].join("\n");

  console.log("\n" + report);
  const outPath = join(REPO_ROOT, "docs/v2/judge-calibration.md");
  writeFileSync(outPath, report + "\n");
  console.log(`\nwrote ${outPath}`);
}

void main();
