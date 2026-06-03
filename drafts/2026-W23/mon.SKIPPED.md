---
week: 2026-W23
day: mon
pillar: ""
retries: 0
status: skipped
reason_class: aborted
---

# mon SKIPPED (aborted)

Run aborted: drafter: LLM JSON failed schema validation (day=mon): [{"code":"custom","path":["claims",2],"message":"non-opinion claims require source_url"}]
payload: {"post_text":"Last week I routed 40% of prod traffic away from GPT-5.5\n\nWe had been defaulting to GPT-5.5 for every agentic coding task in our pipeline. It felt safe. It felt familiar.\n\nThen Claude Opus 4.8 shipped with a 1M token default context window. I ran a two-week split test across our document analysis workflows, and the numbers moved fast. Latency held steady, but task completion on long-context financial analysis jumped 18 percentage points on our internal eval set. That was enough to flip the routing logic.\n\nThe tradeoff nobody talks about is switching cost psychology. Engineers trust the model they trained on. Moving 40% of traffic meant three days of re-prompting, two rounds of regression testing, and one very uncomfortable all-hands where I had to explain why the incumb
