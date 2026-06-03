---
week: 2026-W23
day: fri
pillar: critique
retries: 0
word_count: 270
char_count: 1714
trace_url: https://cloud.langfuse.com/trace/6d259c43043c95c7924c57f686f8b821
---

OpenAI Frontier shipped governance features nobody asked for first

Most coverage framed it as enterprise AI finally growing up. Permissions, shared memory, multi-runtime deployment — the headlines wrote themselves.

What that framing missed is where agent failures actually happen. They happen at routing and evaluation, not at the permissions layer. When an agent picks the wrong tool, calls the wrong sub-agent, or confidently returns a wrong answer, a well-structured permission model does nothing to catch it. I spent three months last year debugging a production agent pipeline for a financial client, and not one incident traced back to access controls. Every single one traced back to a missing eval harness or a bad routing decision upstream.

I want to be fair to OpenAI here. Building shared context and onboarding infrastructure is genuinely hard, and Frontier solves real coordination problems for teams standing up agents across departments. The memory architecture alone addresses something most enterprise builders patch together badly.

But governance without evaluation criteria is a house with a great lock on a door that isn't the front door. The harder problem, the one frontier-lab PMs are debating in private Slack channels right now, is how you define done for an agent task, and how you route dynamically when confidence is low. Frontier does not answer that. It assumes the agent is basically working and adds organizational scaffolding around it.

That is a reasonable first product decision. It may not be the right one.

If you are building on Frontier or evaluating it, I would genuinely like to know where you think the governance gap sits. Routing, evals, or somewhere else entirely?
