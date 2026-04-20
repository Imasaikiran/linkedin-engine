---
week: 2026-W17
day: mon
pillar: shipped
retries: 0
status: skipped
reason_class: gate_fail
---

# mon SKIPPED (gate_fail)

Voice gate failed AFTER critic approval (system bug):
- first line word count 11 (max 10)
- word count 202 outside 220-280
- char count 1258 outside 1300-1700

Draft text:
Routing 40% of Claude calls to GPT-5.4 taught me something uncomfortable

I built our internal triage layer in March, right after GPT-5.4 Thinking shipped on March 5.
The goal was simple: cut inference costs without sacrificing output quality.

I ran 600 production requests through both models over two weeks.
Claude handled nuanced reasoning tasks with fewer correction loops.
GPT-5.4 Thinking won on structured extraction and anything with tight formatting constraints.

The uncomfortable part: I had assumed one model would dominate across the board.
Instead I found myself maintaining two prompt libraries, two eval sets, and two failure taxonomies.
Operational overhead nearly erased the 18% cost reduction I had targeted.

The real lesson was about where the work actually lives.
Routing logic is not a one-time architecture decision.
It is a product surface that needs its own roadmap, its own owner, and its own success metrics.

I kept the split stack, but I scoped it to three task types instead of twelve.
That constraint brought the overhead down enough to make the economics work.

If you are running a multi-model stack right now, how many task types are you actually routing across, and do you have a single person accountable for that layer?
