import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runDrafter, type DrafterSource } from "../agents/drafter.js";
import { makeClient, resolveModelId } from "../lib/llm.js";
import { traced, budgetAbort } from "./_node.js";
import type { GraphStateValue, Day } from "../state.js";
import type { Draft } from "../lib/schema.js";

/** Map each angle's source URLs back to bodies from state.sources. */
function sourcesByDay(state: GraphStateValue): Record<Day, DrafterSource[]> {
  const bodyByUrl = new Map(state.sources.map((s) => [s.url, s.body]));
  const out: Record<Day, DrafterSource[]> = { mon: [], wed: [], fri: [] };
  for (const a of state.angles) {
    out[a.day as Day] = a.sources.map((url: string) => ({ url, body: bodyByUrl.get(url) ?? "" }));
  }
  return out;
}

/**
 * Load up to `max` voice samples (the author's own posts) from the profile's
 * voice corpus dir. The drafter reads these so a draft starts in the author's
 * tone, not a generic one. Strips YAML frontmatter if present.
 */
function loadVoiceSamples(voiceCorpusDir: string, max: number): string[] {
  let files: string[];
  try {
    files = readdirSync(voiceCorpusDir).filter(
      (f) => (f.endsWith(".md") || f.endsWith(".txt")) && f.toLowerCase() !== "readme.md",
    );
  } catch {
    return [];
  }
  return files.slice(0, max).map((f) => {
    const raw = readFileSync(path.join(voiceCorpusDir, f), "utf8");
    return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  });
}

export async function draftNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = makeClient();
  const model = resolveModelId(state.profile.brand.agents.drafter.model);
  const samples = loadVoiceSamples(
    state.profile.voiceCorpusDir,
    state.profile.brand.sources.voice_corpus.samples_per_draft,
  );
  const byDay: Record<Day, string[]> = { mon: samples, wed: samples, fri: samples };
  const { value, costUsd } = await traced(
    "draft",
    model,
    { days: 3, voiceSamples: samples.length },
    async () => {
      const r = await runDrafter({
        client,
        brand: state.profile.brand,
        angles: state.angles,
        sourcesByDay: sourcesByDay(state),
        voiceSamplesByDay: byDay,
      });
      return { value: r.results, costUsd: r.cost_usd, output: { drafted: r.results.length } };
    },
  );
  const drafts: Record<Day, Draft | undefined> = { mon: undefined, wed: undefined, fri: undefined };
  for (const res of value) drafts[res.day as Day] = res.draft;
  return { drafts, costUsd, ...budgetAbort(state, costUsd) };
}
