# Architecture

linkedin-engine turns a voice profile into three publishable LinkedIn drafts a
week. The work is a graph of small, single-purpose nodes. Each node reads the
shared `brand.yaml`, does one job, and writes its result onto graph state. Every
model call is a Langfuse span, so a whole run is one readable trace.

## The graph

```
brand.yaml (profile, the single source of truth)
     |
     v
  scout  ->  strategist  ->  draft (x3)  ->  critic (x3)
   Haiku       Sonnet          Sonnet          Sonnet
                                                  |
                                   approve / fix-soft |  fix-block (retry <= 2)
                                                  v                |
                                              gate (x3) <----------+
                                          fact + voice, deterministic
                                                  |
                                                  v
                                  drafts/YYYY-WW/{mon,wed,fri}.md
                                          (or *.SKIPPED.md)
                                                  |
                                                  v
                          Langfuse: one trace per run, one span per node
```

## Nodes

| Node | Model | Job |
|---|---|---|
| scout | Haiku | Find sources from the last seven days (web search, RSS fallback). |
| strategist | Sonnet | Pick one angle per day, pinned to that day's pillar in `brand.yaml`. |
| draft | Sonnet | Write three drafts in parallel; each emits `claims[]` with source URLs. |
| critic | Sonnet | Read each draft like a target reader; return approve / fix-soft / fix-block. |
| gate | none | Deterministic. Fact gate checks every claim URL is a real scouted source. Voice gate checks rhythm, banned phrases, dashes. |

## Why a graph

The hard problem in agent-written content is knowing when NOT to publish. A graph
makes the decision points explicit: the conditional edge from `critic` back to
`draft` is the retry loop; the gates are the publish/skip fork. You can see the
branch in the trace.

## Reuse from v1

The voice gate, the hallucination (fact) gate, the brand schema, and the JSON
extractor are lifted from v1 unchanged. They carry weeks of tuning. The agent
prompts are lifted too; only their runtime wrapper changed, to add a span.

## Layout

- `packages/engine/src/graph.ts` — the StateGraph wiring.
- `packages/engine/src/state.ts` — the shared state shape.
- `packages/engine/src/nodes/` — one file per node.
- `packages/engine/src/gates/` — deterministic gates.
- `packages/engine/src/lib/` — brand, trace, profile, llm, schema.
- `examples/` — voice profiles. `sai-voice` is the demo; `_template` is blank.
- `packages/engine/src/legacy/` — frozen v1 supervisor, kept one release cycle.
