---
week: 2026-W17
day: mon
pillar: shipped
cost_usd: 0.01599
retries: 0
word_count: 192
char_count: 1192
---

792 critical vulnerabilities found in 30 days by one AI agent

OpenAI's Codex Security ran against OpenSSH, GnuTLS, and Chromium in April 2026. The results landed before most human audit teams would have finished scoping the work.

I watched the numbers come in and kept rechecking them. 792 confirmed CVEs. Not suggestions, not warnings, confirmed critical vulnerabilities. The kind of output that used to take a red team six months and a significant budget to produce.

The tradeoff nobody warned us about: shipping that fast surfaces so many findings that triage becomes the bottleneck, not discovery. We had more confirmed issues than we had engineers to prioritize them. Velocity without intake capacity is just a different kind of debt.

What changed my thinking was realizing Codex is not a coding assistant with a security feature bolted on. It is audit infrastructure. The moment I reframed it that way, the product decisions got clearer. You staff for remediation first, then you turn the agent loose.

Frontier AI is already rewriting what a security team looks like. The question worth sitting with: are you building the intake process before the vulnerabilities arrive, or after?
