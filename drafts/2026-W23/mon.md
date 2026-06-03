---
week: 2026-W23
day: mon
pillar: shipped
retries: 0
word_count: 231
char_count: 1389
trace_url: ""
---

I shipped a multi-agent loop in 4 hours, not 4 days

Last week I built a dynamic workflow inside Claude Code that I expected to take most of a sprint. It finished before lunch.

The project was a content-routing pipeline that needed parallel subagents to classify, score, and escalate documents without a human in the middle. I had tried something similar six months ago and gave up after the coordination overhead ate every hour I saved.

This time, Claude Code's dynamic workflows handled the convergence logic I used to write by hand. The subagents negotiated task boundaries on their own. My actual code contribution dropped to about 30 lines. End-to-end cycle time went from an estimated 3 days to just under 4 hours.

The tradeoff worth naming: I gave up fine-grained visibility into each subagent's intermediate state. When something went sideways in testing, I had to reason backward from outputs rather than inspect a clean step-by-step trace. That debugging tax is real, and I would not ignore it on a compliance-sensitive pipeline.

But for internal tooling where speed matters more than auditability, the math is hard to argue with. A 3-day job becoming a 4-hour job is not a rounding error.

The question I keep turning over: if dynamic orchestration keeps compressing cycle time this aggressively, what work are we currently scoping as a sprint that should just be a morning?
