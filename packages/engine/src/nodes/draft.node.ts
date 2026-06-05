import Anthropic from "@anthropic-ai/sdk";
import { runDrafter, type DrafterSource } from "../agents/drafter.js";
import { resolveModelId } from "../lib/llm.js";
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

export async function draftNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.drafter.model);
  const empty: Record<Day, string[]> = { mon: [], wed: [], fri: [] };
  const { value, costUsd } = await traced(
    "draft",
    model,
    { days: 3 },
    async () => {
      const r = await runDrafter({
        client,
        brand: state.profile.brand,
        angles: state.angles,
        sourcesByDay: sourcesByDay(state),
        voiceSamplesByDay: empty,
      });
      return { value: r.results, costUsd: r.cost_usd, output: { drafted: r.results.length } };
    },
  );
  const drafts: Record<Day, Draft | undefined> = { mon: undefined, wed: undefined, fri: undefined };
  for (const res of value) drafts[res.day as Day] = res.draft;
  return { drafts, costUsd, ...budgetAbort(state, costUsd) };
}
