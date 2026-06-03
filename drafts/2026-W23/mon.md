---
week: 2026-W23
day: mon
pillar: shipped
retries: 0
word_count: 211
char_count: 1207
trace_url: https://cloud.langfuse.com/trace/6cf8859480ec1facac023280be07ed25
---

I shipped a feature in 4 hours that used to take 4 days

Last week I ran a full product cycle inside Claude Code, anchored to Claude Opus 4.8 and its 1M token context window. I expected speed. I did not expect the tradeoffs to surface this fast.

The feature was a filtering layer for a data pipeline. Normally I would spend two days writing specs, one day aligning with eng, and another day reviewing the first draft. This time I fed the entire codebase context in a single session and got a working prototype before lunch.

The uncomfortable part came next. The model surfaced three edge cases I had not written down anywhere. Two of them were real. One was a hallucination that looked credible for about twenty minutes. I almost shipped it.

That near-miss taught me something I keep returning to. Speed without a validation step is just a faster way to introduce debt. I added a lightweight eval pass after every Claude Code session, and the false-positive rate dropped immediately.

AI PMs talk a lot about collapsing product cycles. The honest version of that story includes the moments where you almost trusted the output too much. What does your review step look like after a fast AI-assisted build?
