import { runStrategist } from "../agents/strategist.js";
import { makeClient, resolveModelId } from "../lib/llm.js";
import { traced, budgetAbort } from "./_node.js";
import type { GraphStateValue } from "../state.js";

export async function strategistNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = makeClient();
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
