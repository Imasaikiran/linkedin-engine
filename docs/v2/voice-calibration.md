# Voice-gate calibration

Goal: decide whether the deterministic voice gate
(`packages/engine/src/lib/gate.ts`, `runVoiceGate`) can run in blocking mode, by
measuring how often it FALSELY rejects the author's own owner-approved posts.

The golden corpus (`examples/sai-voice/golden/*.md`) is known-good by definition.
Every golden post the gate fails is a false positive: the gate would block work
the author already published and approved.

Reproduce:

```
pnpm --filter @linkedin-engine/eval exec tsx src/calibrateVoice.ts
```

Script: `packages/eval/src/calibrateVoice.ts`. No API key needed; the voice gate
is pure deterministic logic.

## How the post body is extracted

The corpus has two file shapes, so the script normalizes each one down to the
text the author actually published:

- 9 files (W17/W18/W19/W23) have a real YAML frontmatter block with a `pillar:`
  field. The body is everything after the closing `---`.
- 3 files (W16) have no frontmatter. They start with a section heading like
  `# Monday — Hot take` and end with a `---` separator followed by a
  Sources / Why this angle / Metadata trailer. The script drops the heading line
  (it is a label, not part of the post, and its em dash is not the author's) and
  drops the trailing block after the `---` separator. Pillar is inferred from the
  heading label.

This matters: feeding the gate the raw file would inject the em-dash heading and
the Sources bullet list, which are not part of the published post and would
produce failures that have nothing to do with the author's writing. The
calibration measures the post text only.

## Results

12 golden posts. 3 fail the gate. False-positive rate: 25.0%.

| post | pillar | result | failures |
|---|---|---|---|
| 2026-W16-fri.md | critique | FAIL | first line word count 14 (max 12); word count 129 outside 180-340; char count 873 outside 1100-2150 |
| 2026-W16-mon.md | critique | FAIL | word count 133 outside 180-340; char count 808 outside 1100-2150 |
| 2026-W16-wed.md | framework | FAIL | first line word count 14 (max 12); word count 153 outside 180-340; char count 911 outside 1100-2150 |
| 2026-W17-fri.md | critique | PASS | |
| 2026-W17-mon.md | shipped | PASS | |
| 2026-W17-wed.md | framework | PASS | |
| 2026-W18-fri.md | critique | PASS | |
| 2026-W18-mon.md | shipped | PASS | |
| 2026-W18-wed.md | framework | PASS | |
| 2026-W19-fri.md | critique | PASS | |
| 2026-W19-wed.md | framework | PASS | |
| 2026-W23-wed.md | framework | PASS | |

Summary:

- Total golden posts: 12
- False positives (known-good posts the gate fails): 3
- False-positive rate: 25.0%

## Top failure reasons

| count | reason |
|---|---|
| 3 | word count outside `target_words` band |
| 3 | char count outside `target_chars` band |
| 2 | first line over `hook_max_words` |

All 3 failures are the same 3 posts (the W16 set). Every failure is a rhythm-band
rule. There are zero failures on banned phrases, banned openers, em/en dashes,
emoji, hashtags, paragraph length, lists, or "I" frequency. The gate's content
rules are clean against the corpus; only the length and hook-length bands are
too tight.

Exact measured values on the failing posts:

- W16-fri: first line 14 words, post 129 words, 873 chars
- W16-mon: post 133 words, 808 chars
- W16-wed: first line 14 words, post 153 words, 911 chars

The W16 posts are simply shorter, punchier posts than the band assumes. The
floor of `target_words` is 180 but the author shipped good posts at 129 words.
The floor of `target_chars` is 1100 but the author shipped at 808. The
`hook_max_words` cap is 12 but two approved hooks run 14 words.

## Recommendation

Keep `gates.voice_mode: log_only`. Do NOT flip to `blocking` yet.

25.0% false-positive rate is well above the ~15% safety line. Flipping to
blocking now would reject 1 in 4 of the author's own approved posts, all for
being shorter or having a slightly longer hook than the bands allow, not for any
voice violation.

The gate itself is sound: every false positive traces to three tunable numbers in
`brand.voice.rhythm`. To make blocking safe, widen these bands in
`examples/sai-voice/brand.yaml` to cover the approved posts, then re-run this
calibration:

- `rhythm.target_words`: lower the floor from `180` to about `120` (lowest
  approved post is 129 words; 120 leaves a small margin). Keep the ceiling at
  `340`.
- `rhythm.target_chars`: lower the floor from `1100` to about `800` (lowest
  approved post is 808 chars; 800 leaves a small margin). Keep the ceiling at
  `2150`.
- `rhythm.hook_max_words`: raise from `12` to `14` (two approved hooks are 14
  words).

With those three changes, all 12 golden posts pass and the false-positive rate
goes to 0%, at which point flipping `voice_mode` to `blocking` is safe.

Note: this report does not change the gate mode or `brand.yaml`. It only measures
and recommends. The widening above is a proposal for the profile owner to apply.
