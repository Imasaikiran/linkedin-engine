---
week: 2026-W18
day: fri
pillar: critique
cost_usd: 0.017637
retries: 0
word_count: 229
char_count: 1391
---

Claude Opus 4.7 did not stumble. Anthropic tripped itself

Most people read the launch as a confident stride forward in coding and instruction-following. Fair enough on the surface.

What got buried: the new tokenizer inflates token counts by up to 35% for the same input. That is not a footnote. It is a direct tax on every developer building cost-sensitive pipelines on top of Claude. Quality complaints surfaced within a week of release, which is a brutal timeline for a company whose entire brand promise is "we ship slowly because we ship right."

And the tokenizer story did not land alone. Compute caps on Claude Code appeared around the same time, driven by the strain of agentic workloads. So Anthropic handed developers a pricier model and then rationed access to it. Both hits, same week.

Here is the charitable read I actually believe: Anthropic is navigating a genuine infrastructure ceiling, and the tokenizer change likely funds the compute headroom needed to keep the model family alive at scale. That is a real tradeoff, not malice. But the sequencing was poor, and the communication was nearly silent on the cost implications.

Perfection-first reputations are fragile. One self-inflicted week can do more damage than a competitor's best launch.

Do you think Anthropic recovers the developer trust it spent here, or does this open a door for someone else to walk through?
