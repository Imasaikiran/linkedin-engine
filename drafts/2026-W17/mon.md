---
week: 2026-W17
day: mon
pillar: shipped
cost_usd: 0.015141
retries: 0
word_count: 248
char_count: 1442
---

I shipped faster last week than any sprint this quarter

I made one tool swap on Monday and by Friday my pull request count had doubled. That felt worth examining.

The switch was to Claude Code. I had been using a mix of Codex and manual review cycles, and the context retention between edits kept breaking my flow. Claude Code held the thread across a 400-line refactor without me re-explaining the architecture once. I stopped narrating and started building.

The tradeoff was real, though. Onboarding a new tool mid-sprint costs attention even when the tool is good. The first two days were slower, not faster. I almost reverted on Tuesday afternoon. I stayed because the third session showed me something: I was writing tests I had been skipping, not because I was more disciplined, but because the tool made the next step obvious.

Ramp data published this week put Anthropic at 37% of Q1 enterprise AI spend versus OpenAI at 33%, with Claude Code cited as a primary driver. OpenAI responded by expanding Codex with desktop automation and parallel agent execution on Mac. Both numbers tell me the productivity argument is no longer theoretical.

The question I keep sitting with is not which tool wins. It is whether I was measuring the right thing before. Pull request count is a proxy. What changed for me was the quality of decisions I made while writing the code.

What metric would actually tell you your AI coding tool is working?
