import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { makeClient } from "../lib/llm.js";
import { loadProfile } from "../lib/profile.js";
import { runScout, type ScoutOutput } from "../agents/scout.js";
import { runStrategist } from "../agents/strategist.js";
import { runDrafterOnce, type DrafterSource } from "../agents/drafter.js";
import { runHallucinationGate } from "../lib/gate.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

type Day = "mon" | "wed" | "fri";

function flattenSources(scout: ScoutOutput): { url: string; body: string }[] {
  const out = new Map<string, string>();
  for (const t of [...scout.trending_topics, ...scout.recent_launches]) {
    if (t.url && !out.has(t.url)) out.set(t.url, t.summary);
  }
  return [...out.entries()].map(([url, body]) => ({ url, body }));
}

async function main(): Promise<void> {
  const profile = loadProfile(resolve(REPO_ROOT, "examples/sai-voice"));
  const brand = profile.brand;
  const client = makeClient();
  const rssConfigPath = join(REPO_ROOT, brand.sources.rss_config);

  const scout = await runScout({ client, brand, rssConfigPath });
  const sources = flattenSources(scout);
  console.log(`\n=== SCOUT: ${sources.length} sources (url + summary-length) ===`);
  for (const s of sources) console.log(`  [${s.body.length} chars] ${s.url}`);

  const strat = await runStrategist({ client, brand, scout, clusters: [] });
  const bodyByUrl = new Map(sources.map((s) => [s.url, s.body]));
  const sourcesByDay: Record<Day, DrafterSource[]> = { mon: [], wed: [], fri: [] };
  for (const a of strat.angles) {
    sourcesByDay[a.day as Day] = a.sources.map((url: string) => ({ url, body: bodyByUrl.get(url) ?? "" }));
  }

  const allUrls = new Set(sources.map((s) => s.url));
  const tally = new Map<string, number>();
  let drafterFails = 0;

  for (const angle of strat.angles) {
    const day = angle.day as Day;
    let draft;
    try {
      draft = await runDrafterOnce({ client, brand, angle, sources: sourcesByDay[day], voiceSamples: [] });
    } catch (e) {
      drafterFails++;
      console.log(`\n=== ${day.toUpperCase()}: DRAFTER FAILED :: ${e instanceof Error ? e.message.slice(0, 140) : String(e)}`);
      continue;
    }
    const claims = draft.claims as { claim_text: string; type: string; source_url?: string }[];
    console.log(`\n=== ${day.toUpperCase()} (${draft.pillar}): ${claims.length} claims ===`);
    const gate = runHallucinationGate({ claims: claims as never, sources, voiceCorpusUrls: [] });
    for (const v of gate.verdicts) {
      const c = v.claim;
      const inSrc = c.source_url ? (allUrls.has(c.source_url) ? "url-in-sources" : "URL-NOT-IN-SOURCES") : "no-url";
      console.log(`  [${v.verdict}] type=${c.type} ${inSrc} :: ${v.reason}`);
      console.log(`         claim: "${c.claim_text.slice(0, 90)}"`);
      if (v.verdict !== "PASS") tally.set(v.reason, (tally.get(v.reason) ?? 0) + 1);
    }
    console.log(`  -> day gate pass: ${gate.pass}`);
  }

  console.log("\n=== FAILURE TALLY ===");
  console.log(`  drafter schema failures: ${drafterFails} of ${strat.angles.length} days`);
  for (const [reason, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}x  ${reason}`);
  }
}

void main();
