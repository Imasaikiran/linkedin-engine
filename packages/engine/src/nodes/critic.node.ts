import Anthropic from "@anthropic-ai/sdk";
import { runCritic } from "../agents/critic.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue, Day } from "../state.js";
import type { CriticVerdict } from "../agents/critic.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

export async function criticNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.critic.model);
  const drafts = DAYS.filter((d) => state.drafts[d]).map((d) => ({
    day: d,
    draft: {
      post_text: (state.drafts[d] as { post_text: string }).post_text,
      pillar: (state.drafts[d] as { pillar: string }).pillar,
    },
  }));
  const { value, costUsd } = await traced(
    "critic",
    model,
    { days: drafts.length },
    async () => {
      const r = await runCritic({ client, brand: state.profile.brand, drafts });
      return { value: r.verdicts, costUsd: r.cost_usd, output: { verdicts: r.verdicts.length } };
    },
  );
  const verdicts: Record<Day, CriticVerdict | undefined> = { ...state.verdicts };
  for (const v of value) verdicts[v.day as Day] = v;
  return { verdicts, costUsd };
}
