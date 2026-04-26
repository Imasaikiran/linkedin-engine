---
week: 2026-W17
day: mon
pillar: shipped
cost_usd: 0.013704
retries: 0
word_count: 235
char_count: 1377
---

We hardcoded Claude into our stack and paid for it 3 times

Last year, our team built a document-processing feature directly around Claude Sonnet. Not an abstraction layer. The model name was literally in our config files, our prompt templates, our error messages.

It felt fast. It was fast. We shipped in two weeks and the feature worked beautifully.

Then Claude Sonnet 4.6 dropped. Then GPT-5.4. Then Gemini 3.1 and Grok 4.20, all within weeks of each other. Suddenly our competitors were testing newer models while we were stuck in a refactor that ate an entire sprint.

The tradeoff we missed was not about the models themselves. It was about the assumption baked into our architecture: that the model we chose at launch would stay the best choice. That assumption has a shelf life measured in months, maybe weeks now.

What we should have built was a routing layer with a named interface, something like ModelClient, that swapped providers without touching business logic. We knew this pattern existed. We skipped it because the deadline felt more real than the future technical debt.

The lesson I carried forward: every time you write a model name directly into product code, you are making a bet that the frontier stays still. Right now, that bet loses almost every quarter.

Is your team building for the model you have, or the one you will need six months from now?
