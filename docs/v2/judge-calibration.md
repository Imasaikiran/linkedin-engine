# Judge calibration (leave-one-out over the golden corpus)

Threshold: 3.5
Posts scored: 12
Min: 3  Median: 4  Mean: 4.25
Golden posts that would be REJECTED at this threshold: 1 of 12

| post | score | reason |
|---|---|---|
| 2026-W16-fri.md | 4 | Matches the author's punchy contrarian structure and closing question format, but the argument stays at a higher level of abstraction than the best exemplars, which typically ground the critique in a concrete personal observation or specific technical detail. |
| 2026-W16-mon.md | 4 | Matches the author's sharp contrarian structure and clean closing question, but the argument stays at a higher level of abstraction than the best exemplars, which typically ground the claim in a specific architectural detail or personal observation before landing the provocation. |
| 2026-W16-wed.md | 3 | The numbered framework structure and closing question match the author's pattern, but the draft lacks the author's signature move of grounding the framework in a specific personal anecdote or concrete metric, and the opening hook is weaker and more generic than exemplars like 'We hardcoded Claude into our stack' or the 4-layer context engineering post. |
| 2026-W17-fri.md | 5 | The draft matches the author's signature structure exactly—named assumption, hard reframe, steelmanned counterpoint, sharp closing question—and sustains the same confident, practitioner-grounded voice found across all exemplars. |
| 2026-W17-mon.md | 4 | The draft matches the author's concrete-lesson structure, plain declarative rhythm, and closing question, but the narrative arc (hardcoded → pain → lesson) is slightly more conventional and less contrarian than the exemplars' sharpest reframes. |
| 2026-W17-wed.md | 4 | The numbered framework structure, direct practitioner address, and closing question match the author's voice closely, but the opening line feels slightly more like a headline hook than the author's typical cold-open assertion, and the personal evidence ('cut revision cycles by roughly 40%') is less vivid and grounded than comparables like the hardcoded-Claude story. |
| 2026-W18-fri.md | 5 | The draft matches the author's critique pillar precisely—contrarian reframe up front, structured argument with a charitable-but-sharp pivot, named competitors for texture, a concrete data point (3 conflicting commitments), and a closing question that invites genuine disagreement, all in the same lean, declarative cadence as exemplars 4 and 1. |
| 2026-W18-mon.md | 5 | The draft matches the author's voice precisely: a punchy non-question headline, a clear contrarian insight built around one concrete product decision, a tight cause-effect narrative, and a practitioner-facing closing question—indistinguishable from the shipped/framework exemplars in structure, register, and length. |
| 2026-W18-wed.md | 4 | The numbered framework structure, concrete cost/latency claims, and closing question match the author's framework pillar pattern closely, though the opening hook is slightly more listicle-generic than the author's sharpest intros. |
| 2026-W19-fri.md | 5 | The draft matches the author's signature structure exactly—common read, sharp reframe, concrete evidence, charitable counterpoint, and a closing question—with the same clipped declarative rhythm and willingness to sit in genuine uncertainty. |
| 2026-W19-wed.md | 4 | The numbered framework structure, first-person build evidence, and closing question match the author's voice well, but the explicit name-dropping of Anthropic/OpenAI/DeepMind as a reach-out tactic and the 'Save this post' prompt feel slightly more self-promotional than the author's best framework posts, which let the utility speak for itself. |
| 2026-W23-wed.md | 4 | Matches the author's numbered-framework structure, direct imperative tone, and closing engagement question closely, but the '80% hallucination reduction' claim reads as a slightly inflated credibility prop compared to the more measured '~40% revision cycle' stat in the exemplars, and the final two-sentence CTA feels marginally more formulaic than the author's sharpest closers. |

RECOMMENDATION: keep log_only OR lower the threshold. 1 approved post(s) would be wrongly rejected at 3.5.

---

## Decision (applied to examples/sai-voice/brand.yaml)

- **judge.threshold: 3.0, judge.mode: blocking.** At 3.0, leave-one-out rejects 0 of 12 approved posts while still blocking genuine slop (score 1-2). 3.5 would have rejected 1 borderline post (2026-W16-wed.md, a weaker generic-hook framework post). Validated live: a real run with the judge blocking at 3.0 published a draft (good content scores 4, above the bar).
- **gates.fact_mode: log_only (kept).** Flipping it to blocking was tested live and rejected all 3 drafts (every one `fact_fail`). The v1 hallucination matcher is too strict for the drafter's current claim output: the claim-to-source heuristics (exact digit/quote match) do not line up with how the drafter cites sources. The fact gate needs its claim matcher tuned (or the drafter's claim emission tightened) before it can block. This is why v1 left it unwired.
- **gates.voice_mode: log_only (kept).** No voice-gate calibration exists yet and v1 history shows the voice gate ran too strict. Flipping it blind would over-reject. It needs its own calibration pass before going blocking.

Net: only the **judge** flips to blocking this round. Fact and voice gates stay in log_only pending their own tuning.

Re-run `pnpm --filter @linkedin-engine/eval calibrate` after the golden corpus is curated to ~30 posts to re-confirm the threshold.

---

## Negative test (does slop actually score low?)

Fed the judge 4 deliberate AI-slop drafts plus 1 known-good control. A working
gate must reject the slop and keep the control.

| draft | score |
|---|---|
| control (real golden post) | 5 |
| slop: buzzword soup | 1 |
| slop: generic listicle | 1 |
| slop: hustle motivation | 1 |
| slop: empty thought-leader | 1 |

Clean separation: good = 5, all slop = 1, threshold 3.0 sits in the empty gap.
The blocking gate is a real discriminator, not theater. Reproduce with
`pnpm --filter @linkedin-engine/eval exec tsx src/negTest.ts`.

Remaining gap: no human ground-truth (owner blind-scoring) yet, and Sonnet judges
Sonnet output (circularity), but the slop test shows it is not rubber-stamping.

---

## Human ground-truth validation (blind scoring sheet)

Owner blind-scored 10 drafts (6 real posts + 4 slop, shuffled) via
docs/v2/judge-scoring-sheet.html, then compared against the judge.

Result: **PASS** — median disagreement < 1 point, within-1 agreement >= 80%,
Spearman correlation >= 0.6.

The judge is validated on all three axes: it recognizes good content (calibration),
rejects slop (negative test), and tracks the owner's taste (this sheet). The
blocking gate at threshold 3.0 is trustworthy.
