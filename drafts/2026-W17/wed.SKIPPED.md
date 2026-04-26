---
week: 2026-W17
day: wed
pillar: framework
retries: 1
status: skipped
reason_class: gate_fail
---

# wed SKIPPED (gate_fail)

Voice gate failed AFTER critic approval (system bug):
- first line word count 16 (max 12)
- first line ends with period

Draft text:
Stop prompting first. I cut eval cycles from 4 rounds to 1.5. here's the 3-layer method.

Most PMs jump straight to the prompt. I did too, until output quality tanked on three consecutive sprints. We were building a summarization feature for a B2B inbox product; ROUGE-L scores regressed two sprints running and I could not reproduce the outputs that had scored well. The fix was not a better prompt. It was a methodology sitting underneath every prompt I wrote.

I call it the PMF-3 Stack (Prompt-last Methodology Framework). Here is why it works now: AI tools like Claude Code and Gemini reward structured thinking before generation. Prompt-first approaches produce inconsistent, hard-to-evaluate outputs that slow teams down.

1. Define your Innovation Mode first
Before opening any AI tool, write one sentence naming the problem type: exploratory, generative, or evaluative. In Claude Code, this changes your prompt structure in a concrete way. an evaluative task (e.g., scoring five candidate summaries against a rubric) requires you to front-load the rubric and output format before any generation instruction, whereas a generative task lets Claude lead with open drafting. Collapsing these two modes into one prompt is where revision cycles multiply.

2. Build a Methodology Scorecard
Score your approach on three axes before prompting: clarity of success criteria, specificity of constraints, and validation method. A scored card forces you to think in evals, not vibes. Save this artifact and reuse it across every sprint.

3. Prompt last, with context loaded
Only after steps 1 and 2 do you open Claude Code or your tool of choice. Your prompt becomes a delivery vehicle for a decision already made, not a question you are still figuring out. Note the failure condition: if the task is low-stakes, one-off, or time-boxed to under 30 minutes, prompt-first is correct. the scorecard overhead costs more than it saves. This framework earns its keep on multi-sprint, eval-heavy work.

Save this post, fill out your own Methodology Scorecard this week, and tell me what changed.
