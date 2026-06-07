# LinkedIn Content Engine — Design Spec

**Date:** 2026-04-19
**Owner:** Sai Kiran (sairahul3@gmail.com)
**Status:** Approved for implementation planning

---

## 1. Goal

Build a local-first content engine that produces 3 LinkedIn post drafts per week (Mon/Wed/Fri), grounded in real sources, written in a human voice, so you stay consistent without sounding like a bot.

The engine drafts. The user posts manually.

## 2. Non-goals

- Auto-posting to LinkedIn (deferred indefinitely; manual posting preserves voice control)
- Engagement automation (likes, comments, DMs) — out of scope, ethically dubious
- Scraping internal work artifacts (DVP, PRDs, sprint notes) — explicitly excluded by user
- General-purpose content tool — single-user, single-domain (AI PM)
- Long-form articles — Pillar 1 (monthly long-form) handled manually

## 3. Constraints

- No hallucinated facts. Every numeric claim, named person, quote, capability claim must trace to a source URL.
- No em dashes, no en dashes.
- No LinkedIn AI clichés ("game-changer", "deep dive", "delve", "leverage", "I recently", "Excited to share", etc.) — full banlist in `config/voice-rules.yaml`.
- Each post ends with a genuine question.
- First line is a hook (8–18 words, no period).
- Word counts: Mon 180–220, Wed 150–180, Fri 120–150.
- No more than 2 emojis per post; no opening emoji; max 3 hashtags.
- Reliable across laptop sleep/off — must run on infrastructure that does not depend on the user's machine being awake.

## 4. Content strategy (input from user's strategy doc, condensed)

### Three pillars

1. **Inside the Build** — real stories from shipping AI products. Generated **monthly**, **manually** by the user (engine does not produce these).
2. **PM × AI Frameworks** — practical mental models, playbooks. Wednesdays + some Mondays.
3. **Field Notes from the Frontier** — sharp takes on AI news, model releases, frameworks. Fridays + some Mondays.

### Cadence

| Day | Pillar | Word count | Source |
|---|---|---|---|
| Monday | Pillar 2 or 3 (engine picks based on best material) | 150–180 or 120–150 | Engine |
| Wednesday | Pillar 2 (framework) | 150–180 | Engine |
| Friday | Pillar 3 (hot take) | 120–150 | Engine |
| 1 Mon/month | Pillar 1 (Inside the Build) | 180–220 | User manual |

## 5. Architecture

### 5.1 Pipeline (6 stages, JSON between)

```
[GitHub Actions cron: Sun 00:30 UTC + Wed 00:30 UTC]
       |
       v
1. scrape   →  data/raw/YYYY-WW/{source}.json       (HTTP fetch + RSS)
2. cluster  →  data/clusters/YYYY-WW.json            (embed + dedup by topic)
3. score    →  data/scored/YYYY-WW.json              (heuristic ranking)
4. angle    →  data/angles/YYYY-WW.json              (LLM picks pillar + framing)
5. draft    →  data/drafts/YYYY-WW.json              (LLM writes post + claims[])
6. polish   →  drafts/YYYY-WW/{mon,wed,fri}.md       (gates + final markdown)
```

### 5.2 Design principles

- Each stage idempotent and replayable: `pnpm stage polish --week 2026-W17 --day fri` re-runs only that stage.
- Each stage validates its input + output via zod schemas.
- Each stage logs to `logs/YYYY-WW/{stage}.log` (pino, structured JSON).
- Failure in stage N preserves stages 1..N-1 work.
- The user reads only `drafts/YYYY-WW/*.md`. Everything else is internal.

### 5.3 Stage details

#### Stage 1 — `scrape`

- **Input:** `config/sources.yaml`
- **Sources (locked):**
  - **Lab primary:** Anthropic blog, OpenAI blog, DeepMind blog, Mistral, Cohere, Hugging Face releases
  - **Curated human signal:** Latent Space, The Batch (Andrew Ng), Import AI (Jack Clark), Simon Willison, Interconnects (Nathan Lambert)
  - **LinkedIn/X voices** (style + trend signal): Akash Gupta, Lenny Rachitsky, Shreyas Doshi, Aakash Gupta (PM), Ethan Mollick — via RSS bridges (rsshub.app) for LinkedIn, Nitter for X
  - **HN front-page AI:** Algolia HN API, query "AI" + "LLM" + "agent", min 100 points
- **Behavior:**
  - Parallel fetch with `p-retry` (3 attempts, exp backoff)
  - 1 req/sec per host, jittered
  - User-Agent: `linkedin-engine/0.1 (+github.com/USER/repo)`
  - Honor `robots.txt` via `robots-parser`
  - 7-day window for Sunday run; `since last_run_at` for Wednesday run
  - HTTP cache 6h (avoid re-hammering during reruns)
  - One source 5xx → log + skip, do not abort pipeline
- **Output schema (per item):** `{url, title, body, author, published_at, source}`

#### Stage 2 — `cluster`

- **Input:** all `data/raw/YYYY-WW/*.json`
- **Behavior:**
  - Embed `title + first 200 words` of each item via Voyage-3
  - Cosine similarity > 0.85 → same story group
  - Fallback to local `@xenova/transformers` if Voyage down
- **Output:** `clusters: [{topic, items: [...], earliest_date, source_count}]`
- **Why:** one model release covered by 8 sources = 1 cluster, not 8 posts

#### Stage 3 — `score`

- **Input:** clusters
- **Behavior:** deterministic heuristic, no LLM. All sub-scores normalized to 0–1 before weighting.
  - `novelty` = `max(0, 1 - (age_in_hours / 168))` — linear decay over 7-day window
  - `authority` = `{lab_blog: 1.0, curated_newsletter: 0.6, hn: 0.4, voice_handle: 0.2}` (voice handles signal trend only, never primary source)
  - `confirmation` = `min(1, source_count / 5)` — saturates at 5 sources
  - `controversy` = `min(1, hn_comments / max(1, hn_points)) ` — clipped to 0–1
  - `final = (novelty * 0.3) + (authority * 0.3) + (confirmation * 0.2) + (controversy * 0.2)`
- **Output:** top 10 clusters ranked
- **Why heuristic:** deterministic, debuggable, $0

#### Stage 4 — `angle`

- **Input:** top 10 clusters + last 4 weeks of `data/angles/*.json` (for cross-week dedup)
- **Behavior:**
  - Cross-week dedup: drop any cluster with topic-embedding cosine > 0.85 vs last 4 weeks of picked angles
  - Single Sonnet call: "given these clusters, pick 3 best for Mon/Wed/Fri. Mon = Pillar 2 or 3 (your call). Wed = Pillar 2. Fri = Pillar 3. Return: cluster_id, pillar, one-line angle, why this pillar."
- **Output:** 3 chosen angles with rationale
- **Why separated from draft:** cheap to redo angles without re-paying draft tokens

#### Stage 5 — `draft`

- **Input:** 3 angles + cluster sources + voice corpus samples + pillar template
- **Behavior:**
  - Per draft: one Sonnet call (3 calls in parallel)
  - System prompt = `prompts/voice-system.md` (voice rules + banlist + structural rules)
  - User prompt = pillar template (`prompts/pillars/{framework,hottake,...}.md`) + cluster facts + source URLs + 3 voice corpus samples matching pillar
  - Voice corpus samples instruct: match register, sentence rhythm, paragraph density. Never reuse topics, claims, phrasings.
- **Output schema (per draft):** `{post_text, claims: [{claim_text, type, source_url, confidence}], pillar, angle_rationale}`
- **`claims[]` is the key contract** — feeds the hallucination gate

#### Stage 6 — `polish`

Two gates: hallucination + voice. Both must pass.

##### 6a — Hallucination gate

- **Claim extraction:** second Sonnet call extracts every factual claim as structured JSON: `{claim, type: stat|quote|attribution|capability|date, span: [start,end]}`
- **Source mapping:** for each claim, search every source body in cluster:
  - `stat`: digit + ±5 word window must regex-match source
  - `quote`: exact substring required in source
  - `attribution`: name AND quoted/paraphrased text co-occur in same source
  - `capability`: feature noun + product name co-occur
  - `date`: source `published_at` within 14 days OR explicit date in source
- **Opinion whitelist:** claims tagged `opinion` by extractor bypass mapping. Must NOT contain digits or proper nouns to qualify.
- **Verdict per claim:** PASS / FAIL / SOFT-FAIL (cited but match weak)
- **Voice corpus URLs blocked from `claims[].source_url`** — voice corpus is style-only

##### 6b — Voice gate

Deterministic, regex + count based:

- **Banned-token regex:** em-dash, en-dash, "I recently", "Excited to share", "Today I want to share", "In today's", "game-changer", "thought leader", "deep dive", "delve", "leverage", "synergy", "ecosystem", "unpack", "unlock", "Let that sink in", "Here's the thing", "needless to say", "Furthermore", "Moreover", "In conclusion", "It's worth noting", opening emoji (🚀 ✨ 🎯 💡 🔥), more than 2 emojis total, hashtag count > 3
- **Structural checks:**
  - First line: 8–18 words, no terminal period
  - Last line: must end with `?`
  - Word count within pillar range (Mon 180–220, Wed 150–180, Fri 120–150)
  - No paragraph > 3 lines
  - No bullet points unless framework post
  - "I" frequency < 5% of words

##### Retry loop

```
draft attempt 1 → polish → fails → 
   draft attempt 2 (prompt: "remove these unverified claims: [...]") → polish → fails →
   draft attempt 3 (prompt: "facts-only mode, only state what these sources literally say") → polish →
   still fails → write fri.SKIPPED.md with diagnostic, push notification
```

Max 3 attempts per post. Cost cap ~$0.30/post worst case.

##### Audit trail

Every rejected attempt → `data/rejected/YYYY-WW/{day}.attempt-N.json` with full claims, verdicts, source matches. User can read why a post died.

##### Final markdown format

```markdown
# Friday — Hot take

[post body]

---

**Sources:**
- [Anthropic — Claude 4.7 release](https://anthropic.com/...)
- [HN discussion](https://news.ycombinator.com/...)

**Why this angle:** [one line from stage 4]

**Metadata:** pillar=hottake | retries=1 | cost=$0.18 | gate_pass_rate=100%
```

## 6. Voice fidelity

Five layers:

1. **Banned-token regex** (deterministic) — see 6b above
2. **Structural checks** (deterministic) — see 6b above
3. **Voice corpus few-shot** (LLM) — `data/voice-corpus/external/` refreshed weekly, 5 latest posts per handle (25 total). Per draft: 3 random samples matching pillar. Style-only instruction.
4. **User self-corpus (bootstrap → self-improving):**
   - v0 (weeks 1–4): pure external corpus from `data/voice-corpus/external/`
   - v1 (weeks 5+, 10 posts published): scrape user's own LinkedIn → `data/voice-corpus/self/` → weight 2x in few-shot
   - v2 (week 12+, 30 posts published): drop `external/` from few-shot, run pure self-voice from `self/`. Engine sounds like the user.
5. **Per-pillar template** — 7 prompt templates from user's strategy doc, checked into `prompts/pillars/*.md`

## 7. Reliability

### 7.1 Infrastructure (laptop-independent)

- **GitHub Actions cron** runs full pipeline. Free tier (~64 min/mo used, 2000 min/mo limit).
- Drafts auto-commit to repo on `main`. GitHub mobile push notification on commit = "drafts ready" signal.
- Local `pnpm pipeline` runs same code on demand.

### 7.2 Failure recovery

| Failure | Recovery |
|---|---|
| One source 5xx/timeout | log + skip, pipeline continues |
| All sources for a topic fail | cluster has fewer items, score drops it |
| Anthropic API down | exp backoff 5 retries → abort run → GH issue auto-opened |
| Voyage embed down | fallback to local `@xenova/transformers` |
| All 3 claim-gate retries fail | `{day}.SKIPPED.md` written with diagnostic |
| Cron didn't fire | manual `workflow_dispatch` via GH UI |
| Bad week (3/3 SKIPPED) | GH issue auto-opened; CLI fallback `pnpm draft:freeform --topic "X"` |

### 7.3 Cross-week dedup

After `angle` stage: embed picked cluster topics, cosine vs last 4 weeks. Overlap > 0.85 → kill, pick next-ranked cluster.

### 7.4 Observability

- Per-stage log: `logs/YYYY-WW/{stage}.log`
- Run summary: `data/runs/YYYY-WW.json` — durations, items per source, retry counts, gate stats, $ cost
- GH Actions step summary: markdown table at end of run
- `QUALITY.md` weekly append: retry rate trend, gate fail rate, $/post (catch prompt rot)

### 7.5 Edge cases

| Case | Handling |
|---|---|
| Friday is a holiday | `config/skip-dates.yaml` → write SKIPPED.md with reason "holiday" |
| Big news mid-week (e.g. GPT-5 launches Tue) | Wed cron picks it up; manual `pnpm pipeline:friday` triggers anytime |
| User hates all 3 drafts | `pnpm rerun --week 2026-W17 --from angle` re-rolls cheaply |
| Source publishes paywalled content | scraper detects (text < 200 chars + "subscribe") → discard |

### 7.6 Feedback loop (did the user post it?)

- **v1 (manual):** after posting, user runs `pnpm posted fri --url https://linkedin.com/...`. Moves draft to `posted/YYYY-WW/`, schedules add to self-corpus 30 days later.
- **v2 (auto):** weekly LinkedIn profile scrape, diff vs drafts. Deferred until v1 friction proven.

## 8. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 20+ | Fits user familiarity, GH Actions native |
| Language | TypeScript | Type safety on stage I/O |
| Package manager | pnpm | Fast, deterministic |
| LLM (drafting, claim extract, angle) | Claude Sonnet 4.6 | Best voice quality |
| LLM (cheap stages — none currently, reserved) | Claude Haiku 4.5 | If cost rises |
| Embeddings | Voyage-3 via Anthropic | High quality, cheap |
| HTTP | native fetch + p-retry | Stdlib + minimal dep |
| RSS | rss-parser | Battle-tested |
| HTML scrape | cheerio | Stdlib for HTML |
| Schema validation | zod | Stage I/O contracts |
| Logger | pino | Structured JSON, fast |
| Tests | vitest | Fast, modern |
| Schedule | GitHub Actions cron | Laptop-independent |
| Storage | repo itself | No DB, no KV |

## 9. Repo layout

```
linkedin-engine/
├── .github/workflows/
│   ├── pipeline.yml          # cron: Sun 00:30 UTC + Wed 00:30 UTC
│   └── rerun.yml             # workflow_dispatch (manual stage rerun)
├── config/
│   ├── sources.yaml          # RSS, blog URLs, voice handles, HN config
│   ├── voice-rules.yaml      # banned tokens, structural rules
│   ├── pillars.yaml          # cadence, word counts, retry caps
│   └── skip-dates.yaml       # holidays
├── prompts/
│   ├── pillars/
│   │   ├── framework.md
│   │   ├── hottake.md
│   │   ├── story.md
│   │   ├── lesson.md
│   │   ├── myth.md
│   │   ├── observation.md
│   │   └── list.md
│   ├── extract-claims.md
│   ├── pick-angle.md
│   └── voice-system.md
├── src/
│   ├── stages/
│   │   ├── scrape.ts
│   │   ├── cluster.ts
│   │   ├── score.ts
│   │   ├── angle.ts
│   │   ├── draft.ts
│   │   └── polish.ts
│   ├── lib/
│   │   ├── llm.ts            # Anthropic client wrapper
│   │   ├── embed.ts          # Voyage client + fallback
│   │   ├── fetch.ts          # HTTP w/ retry, UA, robots, cache
│   │   ├── rss.ts
│   │   ├── schema.ts         # zod schemas (per-stage I/O)
│   │   ├── log.ts            # pino setup w/ redact
│   │   └── gate.ts           # hallucination + voice gates
│   ├── pipeline.ts           # orchestrator: runs all 6 stages
│   └── cli.ts                # local trigger + posted-mark + freeform
├── data/                     # all stage JSON, voice-corpus, rejected, runs
│   ├── raw/
│   ├── clusters/
│   ├── scored/
│   ├── angles/
│   ├── drafts/
│   ├── voice-corpus/
│   │   ├── external/
│   │   └── self/
│   ├── rejected/
│   └── runs/
├── drafts/                   # FINAL .md — user reads only here
│   └── YYYY-WW/{mon,wed,fri}.md
├── posted/                   # archive after manual posted-mark
├── logs/
├── tests/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-19-linkedin-engine-design.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── QUALITY.md                # appended weekly by pipeline
└── README.md
```

## 10. Scripts

```
pnpm pipeline                                          # full week run (Sun)
pnpm pipeline:friday                                   # mid-week rerun, Friday only
pnpm stage scrape                                      # single stage
pnpm stage polish --week 2026-W17 --day fri            # re-polish one post
pnpm rerun --week 2026-W17 --from angle                # re-roll from a stage
pnpm voice:refresh                                     # refresh voice corpus only
pnpm posted fri --url https://linkedin.com/...         # mark posted (feedback loop)
pnpm draft:freeform --topic "X" --pillar hottake       # bypass scrape, single post
pnpm test
```

## 11. Secrets

| Secret | Where |
|---|---|
| `ANTHROPIC_API_KEY` | `.env` (local), GH Actions encrypted secret (CI) |
| `VOYAGE_API_KEY` | same |
| `USER_AGENT` | non-secret, set in `.env` for politeness |

pino redact list: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, any header containing `auth`.

## 12. Cost

| Stage | LLM calls/week | Cost/week |
|---|---|---|
| Scrape | 0 | $0 |
| Cluster (embed) | ~200 chunks | $0.05 |
| Score | 0 | $0 |
| Angle | 1 Sonnet | $0.02 |
| Draft | 3 posts × ~1.5 retries | $0.45 |
| Polish (claim extract) | ~3 × 1.5 | $0.15 |
| **Total/week** | | **~$0.70** |
| **Total/month** | | **~$3** |

GH Actions: ~8 min/run × 8 runs/mo = 64 min, well under 2000-min free tier.

## 13. Success criteria

- 3 drafts produced per week, ≥ 90% of weeks (≤ 1 SKIPPED-day per month)
- Each draft has every claim source-mapped (zero hallucinated stats/quotes/attributions)
- Each draft passes voice gate without manual edit
- User publishes ≥ 80% of drafts as-is or with < 2 minutes of edits
- By month 3: 36+ posts published, voice corpus self-bootstrapped, retry rate trending down

## 14. Out of scope (explicit deferrals)

- Auto-posting to LinkedIn (LinkedIn API + OAuth + approval gate)
- LinkedIn analytics ingestion (which posts performed)
- Multi-user support
- Web UI
- Pillar 1 (Inside the Build) generation — user-authored
- Auto-detect feedback loop (v2)
- Long-form article drafting (monthly portfolio piece)
