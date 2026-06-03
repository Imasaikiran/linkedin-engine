---
week: 2026-W23
day: fri
pillar: critique
retries: 0
word_count: 231
char_count: 1453
trace_url: https://cloud.langfuse.com/trace/6cf8859480ec1facac023280be07ed25
---

OpenAI Frontier launched this week and I think it misframes agent governance

The common read is that shared context, permissions, and memory finally give enterprises a coherent agent platform story. That read is not wrong, exactly.

What it misses is the assumption baked underneath. Frontier treats governance as a configuration problem: set the right permissions, wire the right runtimes, and control follows. But anyone who has spent time managing probabilistic model behavior knows that failure modes do not respect permission trees. A well-scoped agent can still drift in ways no access control catches.

I shipped a workflow last year where 3 out of every 100 agent runs produced outputs that were technically within permissions and completely wrong for the context. The permission model passed. The product failed.

To be fair to OpenAI, Frontier is solving a real and urgent problem. Enterprises need a place to start, and shared context across local, cloud, and hosted runtimes is genuinely useful scaffolding. The critique is not that they built the wrong thing. It is that calling it governance may set expectations the determinism model cannot meet.

Real agent governance has to live in feedback loops, not just permission layers. That means connecting failure signals back to the people making model and product decisions, not just the people setting roles.

Do you think Frontier's model is enough, or are we papering over the hard part?
