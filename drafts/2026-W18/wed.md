---
week: 2026-W18
day: wed
pillar: framework
cost_usd: 0.018099
retries: 0
word_count: 220
char_count: 1365
---

3 reasons hard-coding model names is technical debt

March 2026 proved it: GPT-5.4, Gemini 3.1, and Grok 4.20 all shipped in a single month. If your product logic has a model name baked in, you are one release cycle away from a refactor sprint you did not plan for.

I built this framework after watching three separate teams scramble to swap dependencies mid-quarter. Save it.

1. Coupling kills velocity
Every time a frontier model updates, a hard-coded reference becomes a change request. Teams I spoke with lost an average of 2 weeks per major model swap, just on regression testing and prompt re-tuning.

2. Evals are the real abstraction layer
Instead of naming GPT-5.4 in your config, define what good output looks like. Synthetic evals and automated reasoning validation let you swap the underlying model without touching product logic. The eval suite becomes your contract.

3. Standardize the stack, not the vendor
Product Ops should own an AI stack standard that specifies input/output schemas, latency thresholds, and hallucination benchmarks. The vendor slot stays interchangeable. This is how portfolio-centric roadmaps stay stable when the model landscape shifts every few weeks.

If you are an AI PM still routing decisions through a specific model name, try this: write one eval that any model must pass before it enters your pipeline. Start there.
