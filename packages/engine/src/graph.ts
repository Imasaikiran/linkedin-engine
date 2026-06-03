import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphAnnotation, type GraphStateValue, type Day } from "./state.js";
import { scoutNode } from "./nodes/scout.node.js";
import { strategistNode } from "./nodes/strategist.node.js";
import { draftNode } from "./nodes/draft.node.js";
import { criticNode } from "./nodes/critic.node.js";
import { gateNode } from "./nodes/gate.node.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

/** After strategist: an abort short-circuits to the gate (which writes skips). */
function routeAfterStrategist(state: GraphStateValue): "draft" | "gate" {
  return state.aborted ? "gate" : "draft";
}

/** After critic: retry the draft if any day is fix-block and we have budget. */
function routeAfterCritic(state: GraphStateValue): "retry" | "gate" {
  if (state.aborted) return "gate";
  const max = state.profile.brand.agents.max_retry_loops;
  const anyBlocked = DAYS.some((d) => {
    const v = state.verdicts[d];
    return v && v.verdict === "fix" && v.severity === "block";
  });
  if (anyBlocked && state.retryPass < max) return "retry";
  return "gate";
}

/** Bump the retry-pass counter when looping back to draft (guards termination). */
async function bumpRetry(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  return { retryPass: state.retryPass + 1 };
}

export function buildGraph() {
  return new StateGraph(GraphAnnotation)
    .addNode("scoutStep", scoutNode)
    .addNode("strategist", strategistNode)
    .addNode("draft", draftNode)
    .addNode("critic", criticNode)
    .addNode("bumpRetry", bumpRetry)
    .addNode("gate", gateNode)
    .addEdge(START, "scoutStep")
    .addEdge("scoutStep", "strategist")
    .addConditionalEdges("strategist", routeAfterStrategist, { draft: "draft", gate: "gate" })
    .addEdge("draft", "critic")
    .addConditionalEdges("critic", routeAfterCritic, { retry: "bumpRetry", gate: "gate" })
    .addEdge("bumpRetry", "draft")
    .addEdge("gate", END)
    .compile();
}
