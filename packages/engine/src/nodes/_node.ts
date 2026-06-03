import { observe } from "../lib/trace.js";

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
