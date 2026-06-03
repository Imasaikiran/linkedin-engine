import Anthropic from "@anthropic-ai/sdk";
import { runStrategist } from "../agents/strategist.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue } from "../state.js";

/**
 * Decide whether the run should abort after a node spent `thisNodeCost`.
 * Returns an empty object when within budget, or an abort patch otherwise.
 * Cost is folded into state separately by the caller; this never returns cost.
 * startedAt === 0 disables the wall-time check (unit tests that do not set it).
 */
export function budgetAbort(
  state: GraphStateValue,
  thisNodeCost: number,
): { aborted: true; abortReason: string } | Record<string, never> {
  const projected = state.costUsd + thisNodeCost;
  if (projected > state.profile.brand.budgets.cost_usd_per_run) {
    return { aborted: true, abortReason: "cost-cap-exceeded" };
  }
  const wallMs = state.profile.brand.budgets.wall_time_seconds * 1000;
  if (state.startedAt !== 0 && Date.now() - state.startedAt > wallMs) {
    return { aborted: true, abortReason: "wall-time-exceeded" };
  }
  return {};
}

export async function strategistNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.strategist.model);
  const { value, costUsd } = await traced(
    "strategist",
    model,
    { angleCount: 3 },
    async () => {
      const r = await runStrategist({
        client,
        brand: state.profile.brand,
        scout: state.scout!,
        clusters: [],
      });
      return { value: r.angles, costUsd: r.cost_usd, output: { angles: r.angles.length } };
    },
  );
  if (value.length !== 3) {
    return {
      aborted: true,
      abortReason: `strategist_incomplete: got ${value.length} angles`,
      costUsd,
    };
  }
  return { angles: value, costUsd, ...budgetAbort(state, costUsd) };
}
