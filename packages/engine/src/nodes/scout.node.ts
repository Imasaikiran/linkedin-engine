import Anthropic from "@anthropic-ai/sdk";
import { runScout, type ScoutOutput } from "../agents/scout.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue } from "../state.js";

/** Build the flat (url, body) source list the fact gate needs, from scout output. */
function flattenSources(scout: ScoutOutput): { url: string; body: string }[] {
  const out = new Map<string, string>();
  for (const t of [...scout.trending_topics, ...scout.recent_launches]) {
    if (t.url && !out.has(t.url)) out.set(t.url, t.summary);
  }
  return [...out.entries()].map(([url, body]) => ({ url, body }));
}

export async function scoutNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.scout.model);
  const { value: scout, costUsd } = await traced(
    "scout",
    model,
    { window_days: 7 },
    async () => {
      const r = await runScout({ client, brand: state.profile.brand });
      return { value: r, costUsd: r.cost_usd, output: { source: r.source } };
    },
  );
  return { scout, sources: flattenSources(scout), costUsd };
}
