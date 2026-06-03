import { join, resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { run } from "./run.js";
import { emitDrafts } from "./lib/emit.js";
import { makeLogger } from "./lib/log.js";

const log = makeLogger({ name: "cli" });

// Repo root is three levels up from packages/engine/src/cli.ts, regardless of
// the process cwd. This keeps `examples/<p>` and `drafts/` stable whether the
// CLI runs from the repo root, the package dir, or CI.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Load <repo>/.env locally. override:true so a real key in .env wins over an
// empty ANTHROPIC_API_KEY exported by the shell. In CI the file is absent and
// keys come from the process env (GitHub secrets); dotenv no-ops when missing.
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const profileArg = arg("--profile");
  if (!profileArg) {
    console.error("usage: pipeline --profile <dir> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const profileDir = isAbsolute(profileArg) ? profileArg : resolve(REPO_ROOT, profileArg);
  const dryRun = process.argv.includes("--dry-run");
  const repoRoot = REPO_ROOT;

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
