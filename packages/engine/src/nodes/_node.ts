import { observe } from "../lib/trace.js";
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

/**
 * Wrap an agent call as a traced unit. `fn` returns the agent's value plus its
 * cost (and optional token counts); the helper records the generation span and
 * hands back { value, costUsd } so the node can fold cost into the summing
 * costUsd channel.
 */
export async function traced<T>(
  name: string,
  model: string,
  input: unknown,
  fn: () => Promise<{
    value: T;
    costUsd: number;
    inputTokens?: number;
    outputTokens?: number;
    output?: unknown;
  }>,
): Promise<{ value: T; costUsd: number }> {
  let costUsd = 0;
  const value = await observe<T>(name, { model, input }, async () => {
    const r = await fn();
    costUsd = r.costUsd;
    return {
      value: r.value,
      usage: {
        output: r.output,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
      },
    };
  });
  return { value, costUsd };
}
