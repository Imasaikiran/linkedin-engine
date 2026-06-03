import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";
import { runJudge } from "./judge.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

// Deliberate AI-slop drafts. A working judge should score these <= 2.
const SLOP: { label: string; text: string }[] = [
  {
    label: "slop-buzzword-soup",
    text: `🚀 Thrilled to share some exciting news!

In today's fast-paced world, AI is a game-changer that is revolutionizing every industry.

I'm passionate about leveraging cutting-edge synergies to unlock value across the ecosystem.

Let's dive deep and unpack how we can all win together. 💡

The future is here. Are you ready to embrace it?

#AI #Innovation #Leadership #Growth #Future`,
  },
  {
    label: "slop-generic-listicle",
    text: `5 lessons I learned this week 👇

1. Always believe in yourself
2. Hard work beats talent
3. Surround yourself with great people
4. Never give up on your dreams
5. Consistency is key

Which one resonates with you the most?

Let that sink in.

#Motivation #Success #Mindset`,
  },
  {
    label: "slop-hustle-motivation",
    text: `Most people will never succeed.

Here's the thing: while you're sleeping, someone else is grinding.

I woke up at 4am today. Did you?

Success isn't given. It's taken.

Stop making excuses and start making moves.

Agree?`,
  },
  {
    label: "slop-empty-thought-leader",
    text: `Leadership is not about titles.

As a thought leader in the space, I've seen it all.

True leaders empower their teams to reach their full potential and drive impactful outcomes at scale.

It's all about the journey, not the destination.

What does leadership mean to you?`,
  },
];

async function main(): Promise<void> {
  const profile = loadProfile(resolve(REPO_ROOT, "examples/sai-voice"));
  const goldenDir = join(profile.profilePath, profile.brand.judge.golden_dir);
  const model = profile.brand.agents.critic.model;
  const threshold = profile.brand.judge.threshold;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  // Positive control: a real golden post (should score high). Excluded from its
  // own exemplar set is not needed here; we just want a known-good anchor.
  const goldFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const control = { label: `control-${goldFiles[0]}`, text: readFileSync(join(goldenDir, goldFiles[0]!), "utf8") };

  const cases = [control, ...SLOP];
  console.log(`threshold = ${threshold}  (blocking rejects below this)\n`);
  const rows: { label: string; score: number; reason: string }[] = [];
  for (const c of cases) {
    const { result } = await runJudge({ client, model, draftText: c.text, goldenDir });
    rows.push({ label: c.label, score: result.score, reason: result.reason });
    console.log(`  ${c.label}: ${result.score}`);
  }

  const slopRows = rows.filter((r) => r.label.startsWith("slop"));
  const controlScore = rows.find((r) => r.label.startsWith("control"))!.score;
  const slopMax = Math.max(...slopRows.map((r) => r.score));
  const slopAllBlocked = slopRows.every((r) => r.score < threshold);

  console.log("\n| draft | score | reason |\n|---|---|---|");
  for (const r of rows) console.log(`| ${r.label} | ${r.score} | ${r.reason.replace(/\|/g, "/")} |`);

  console.log("\n--- VERDICT ---");
  console.log(`control (known-good) scored: ${controlScore} (want >= ${threshold})`);
  console.log(`worst slop scored: ${slopMax} (want < ${threshold})`);
  console.log(
    slopAllBlocked && controlScore >= threshold
      ? "PASS: judge separates slop from good. The gate is real."
      : "FAIL: judge does not cleanly separate slop from good. Threshold is theater.",
  );
}

void main();
