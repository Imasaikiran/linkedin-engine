import { join } from "node:path";
import { run } from "./run.js";
import { emitDrafts } from "./lib/emit.js";
import { makeLogger } from "./lib/log.js";

const log = makeLogger({ name: "cli" });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const profileDir = arg("--profile");
  if (!profileDir) {
    console.error("usage: pipeline --profile <dir> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  const repoRoot = process.cwd();

  const result = await run({ profileDir, dryRun });
  emitDrafts({
    draftsRoot: join(repoRoot, "drafts"),
    week: result.week,
    drafts: result.drafts,
    days: result.days,
    traceUrl: result.traceUrl,
  });

  const published = result.days.filter((d) => d.status === "published").length;
  log.info(
    {
      week: result.week,
      published,
      skipped: result.days.length - published,
      cost_usd: result.costUsd,
      trace_url: result.traceUrl,
      aborted: result.aborted,
    },
    "run complete",
  );
  console.log(`\nweek ${result.week}: ${published}/3 published, $${result.costUsd.toFixed(4)}`);
  if (result.traceUrl) console.log(`trace: ${result.traceUrl}`);
  process.exitCode = published > 0 ? 0 : 1;
}

void main();
