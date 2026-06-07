# linkedin-engine v2: Technical Design Spec

**Status:** Draft, awaiting owner approval
**Date:** 2026-06-03
**Author:** Sai Kiran
**Companion docs:** [PRD-v2.md](../../../PRD-v2.md), [brand.yaml](../../../brand.yaml), [v1 spec](./2026-04-19-linkedin-engine-design.md)

---

## 1. Summary

Re-architect linkedin-engine as a public, open source agent product. Replace the v1 hand-rolled stage script with a LangGraph-JS state graph. Wire Langfuse traces on every node. Add a deterministic fact gate. Add an LLM judge with a golden corpus. Add a Supabase-backed dashboard. Strip the owner-specific job-hunt framing out of the engine; make the engine voice-agnostic and ship the owner's voice as a public example profile.

Ship v2.0 in a 24-hour build window. Test on real cron runs for 2 to 3 days. Launch publicly after the first green cron run.

## 2. Goals and non-goals

### Goals

1. Public OSS repo at `Imasaikiran/linkedin-engine` (MIT licensed).
2. LangGraph-JS state graph replaces v1 sequential script.
3. Langfuse Cloud trace per run, every node a span, public-readable for the demo profile.
4. Deterministic fact gate wired (closes the v1 TODO).
5. LLM judge against a 30-post golden corpus, threshold-gated.
6. Supabase Postgres for run stats and source dedup.
7. Public Next.js dashboard on Vercel.
8. GitHub Actions cron unchanged (Sun + Wed 00:30 UTC).
9. Voice-agnostic engine. `examples/sai-voice/` is the demo profile.
10. No regression in v1 cost or wall-time targets ($0.40 hard cap, ~90 seconds).

### Non-goals (v2.0)

- pgvector memory for voice exemplars. Defer to v2.1.
- Auto-posting to LinkedIn.
- Multi-channel (Twitter, Substack).
- Multi-tenant SaaS.
- Image / carousel / video generation.
- Engagement-based feedback loop.
- npm publish (deferred to v2.1).

## 3. Architecture

### 3.1 Topology

```
                           brand.yaml (per-profile)
                                    |
                                    v
                    +-------------------------------+
                    |  LangGraph-JS supervisor      |
                    +---------------+---------------+
                                    |
   +---------+   +-----------+   +----------+   +----------+
   |  Scout  |-->|Strategist |-->|Drafter x3|-->|Critic x3 |
   |  Haiku  |   |  Sonnet   |   | Sonnet   |   | Sonnet   |
   +---------+   +-----------+   +----------+   +----------+
                                                     |
                                                     v
                                    +----------------------------+
                                    | Fact gate (deterministic)  |
                                    | Voice gate (deterministic) |
                                    | Judge (LLM, threshold)     |
                                    +----------------------------+
                                                     |
                                                     v
                                  drafts/YYYY-WW/{mon,wed,fri}.md
                                                     |
                                                     v
   +-----------------------------------------------------+
   |  Langfuse Cloud: span per node, run = single trace  |
   |  Supabase Postgres: runs, sources_seen              |
   |  Vercel dashboard: reads Supabase                   |
   +-----------------------------------------------------+
```

### 3.2 Graph state shape

```ts
type GraphState = {
  runId: string;             // UUID v4, also Langfuse trace ID
  week: string;              // "2026-W23"
  day: "mon" | "wed" | "fri";
  profile: BrandProfile;     // loaded from brand.yaml
  sources: SourceItem[];     // populated by Scout
  angle: StrategistAngle;    // populated by Strategist
  draft?: Draft;             // populated by Drafter, possibly retried
  critic?: CriticVerdict;    // populated by Critic
  retries: number;
  gateResults: {
    fact?: GateResult;
    voice?: GateResult;
    judge?: JudgeResult;
  };
  status: "running" | "published" | "skipped";
  skipReason?: string;
  costUsd: number;           // accumulated across all nodes
};
```

Three independent runs per week (one per day) run in parallel. Each owns its own graph state and Langfuse trace.

### 3.3 Edges

```
scout -> strategist -> drafter -> critic -> route
route:
  if critic.verdict == "fix-block" and state.retries < 2:
      retries += 1; -> drafter
  else if critic.verdict in ("approve", "fix-soft"):
      -> factGate
  else:
      status = "skipped"; reason = "critic-blocked-after-max-retries"

factGate -> if pass: voiceGate else skipped
voiceGate -> if pass: judge else skipped
judge -> if score >= threshold: publish else skipped

publish -> writeFile(drafts/WW/{day}.md), set status="published"
skipped -> writeFile(drafts/WW/{day}.SKIPPED.md)
finalize -> upsert runs row in Supabase, close Langfuse trace
```

## 4. Components

### 4.1 Engine package (`packages/engine`)

| File | Role |
|---|---|
| `src/graph.ts` | LangGraph supervisor: nodes, edges, conditional routing |
| `src/nodes/scout.ts` | Haiku + web_search; RSS fallback via `sources.yaml` |
| `src/nodes/strategist.ts` | Sonnet; picks one angle per day pinned to `brand.cadence[day].pillar` |
| `src/nodes/drafter.ts` | Sonnet; emits `{body, claims[]}` with `claim.source_url` |
| `src/nodes/critic.ts` | Sonnet; verdict `approve / fix-soft / fix-block` + `specific_fixes[]` |
| `src/gates/factGate.ts` | Deterministic: every `claim.source_url` must appear in `state.sources` |
| `src/gates/voiceGate.ts` | Ported from v1; reads `brand.voice` rules; runs `log_only` mode for 48h |
| `src/gates/judge.ts` | Sonnet; score 1 to 5 against `golden/` corpus; threshold from `brand.yaml` |
| `src/lib/trace.ts` | Langfuse client wrapper; one trace per run, span per node |
| `src/lib/profile.ts` | Loads `brand.yaml`, validates with zod schema |
| `src/lib/llm.ts` | Anthropic SDK wrapper, adds Langfuse span metadata |
| `src/lib/cost.ts` | Token-to-USD math, accumulated on state |
| `src/lib/db.ts` | Supabase client, `runs` and `sources_seen` upserts |

### 4.2 Dashboard package (`packages/dashboard`)

Next.js 15 app router. Single page (`/`). Reads Supabase directly via service role on the server side. Renders:

- Last 10 runs (table): week, day, status, cost, retries, trace link
- 12-week sparkline: pass rate and cost per run
- "Latest drafts" panel: last 3 published drafts, body excerpts
- README excerpt and link to public Langfuse project

No interactive controls. Read-only.

### 4.3 Eval package (`packages/eval`)

| File | Role |
|---|---|
| `golden/*.md` | 30 owner-approved past posts (15 from v1 drafts + 15 historical LinkedIn posts), front-matter for pillar |
| `src/judge.ts` | Loads golden corpus, calls Sonnet, returns `{score, reason}` |
| `src/runEval.ts` | Runs judge against a draft; used by graph and by CI |
| `.github/workflows/eval.yml` | On PR, runs judge against last 3 drafts; comments score to PR |

### 4.4 Example profile (`examples/sai-voice/`)

```
examples/sai-voice/
  brand.yaml          # voice-agnostic schema, owner's values
  golden/             # 30 markdown posts for the judge
  README.md           # "this is the demo profile, fork to make your own"
```

The engine never references this folder by name. Profile path is a CLI arg.

## 5. Configuration

### 5.1 `brand.yaml` schema (v2, voice-agnostic)

```yaml
identity:
  role: string
  audience:
    primary: string
    secondary: string
  positioning: string

voice:
  must_have_in_every_post: string[]
  must_not_have:
    em_dashes: bool
    en_dashes: bool
    banned_phrases: string[]
    banned_openers: string[]
  rhythm:
    hook_max_words: int
    paragraph_max_lines: int
    target_words: [int, int]
    target_chars: [int, int]

cadence:
  mon: { pillar: string, template: string, requires: string[] }
  wed: { ... }
  fri: { ... }

models:
  scout: "claude-haiku-4-5-20251001"
  strategist: "claude-sonnet-4-6"
  drafter: "claude-sonnet-4-6"
  critic: "claude-sonnet-4-6"
  judge: "claude-sonnet-4-6"

budgets:
  cost_usd_per_run_cap: 0.50
  wall_time_seconds_cap: 180

judge:
  threshold: 3.5
  golden_dir: "golden/"

gates:
  voice_mode: "blocking" | "log_only"     # log_only for first 48h
  fact_mode: "blocking" | "log_only"      # log_only for first 48h
```

The v1 fields `identity.role: "Senior AI PM..."` and `identity.goal: "..."` move into `examples/sai-voice/brand.yaml` only. The schema does not name them; the example does.

### 5.2 Environment variables

```
ANTHROPIC_API_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
SUPABASE_URL=
SUPABASE_SERVICE_ROLE=
PROFILE_PATH=examples/sai-voice    # CLI arg overrides
LOG_LEVEL=info
```

GitHub Actions reads from repository secrets. Local reads from `.env`.

### 5.3 Supabase schema

```sql
create table runs (
  id uuid primary key default gen_random_uuid(),
  week text not null,                    -- 2026-W23
  day text not null check (day in ('mon','wed','fri')),
  profile text not null,                 -- examples/sai-voice
  status text not null,                  -- published | skipped
  skip_reason text,
  retries int not null default 0,
  cost_usd numeric(6,4) not null,
  duration_s numeric(6,1) not null,
  trace_url text not null,
  body_md text,
  claims_json jsonb,
  gate_results jsonb,
  created_at timestamptz not null default now()
);
create index runs_week_day_idx on runs (week, day);

create table sources_seen (
  url text primary key,
  first_seen_week text not null,
  title text,
  excerpt text
);
```

A row in `sources_seen` is added every time the Scout returns a URL not yet present. Scout dedupes its results against this table for a 4-week window before passing to the Strategist.

## 6. Tracing

Every node emits one Langfuse span. The supervisor opens one trace per run. Trace ID = run ID = the row PK in `runs`. Trace metadata includes:

- `week`, `day`, `profile`
- `model` per node
- `tokens_in`, `tokens_out`, `cost_usd` per node
- For drafter and critic: the full prompt and response for **published** runs; redacted response (body removed, structure kept) for **skipped** runs
- For gates: pass/fail with reason class

Public Langfuse project for the `examples/sai-voice` profile. Anyone with the link can read the trace. Skipped-run bodies are never exposed publicly (privacy: a draft that did not meet the bar should not live forever in a public trace).

Cost accumulation is computed locally from token counts (cross-checked against Langfuse weekly). Hard cap aborts the graph and writes `*.SKIPPED.md` with `skip_reason="cost-cap-exceeded"`.

## 7. CI and workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `cron.yml` | Sun + Wed 00:30 UTC | `pnpm pipeline --profile examples/sai-voice` for all 3 days in parallel; commit drafts to `main` |
| `eval.yml` | PR to `main` | Run judge against last 3 published drafts; comment scores |
| `ci.yml` | Push, PR | Typecheck, lint, vitest, dry-run pipeline with fixtures |

All workflows use Node 20, pnpm 10, cache `~/.pnpm-store`.

## 8. Dashboard

`linkedin-engine.vercel.app` (or chosen domain).

Single page. Server components only. Reads from Supabase via service role (server-side env var). No auth required for read-only view.

Page structure:

- Header: project name, GitHub link, Langfuse public project link
- Section 1: "Last 10 runs" table
- Section 2: 12-week pass rate sparkline, 12-week cost sparkline
- Section 3: "Latest published drafts" (3 cards, first 200 chars each, link to full file on GitHub)
- Footer: built-with credits (LangGraph, Anthropic, Langfuse, Supabase, Vercel)

Performance: static-render on every cron, then revalidate every 60s.

## 9. Migration from v1

v1 lives on `main` until v2 cuts over. Build v2 on branch `v2-langgraph`. Cutover criteria:

1. v2 produces drafts identical in quality to v1 on 3 dry runs (manual judge by owner).
2. Langfuse traces clean and complete on 3 dry runs.
3. Dashboard rendering correctly with 3 dry-run rows in Supabase.

Cutover commit replaces `src/agentic-pipeline.ts` with the LangGraph wrapper. The old file moves to `archive/v1-pipeline.ts` for reference for 1 release cycle.

The v1 `posted/` directory carries over. `drafts/` directory unchanged.

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LangGraph-JS API gaps for parallel fan-out | Medium | High | Spike in first 2 hours; if blocked, fall back to "supervisor function + Promise.all" pattern, keeping Langfuse spans manually |
| Langfuse Cloud rate limit | Low | Medium | One project, batch span flush at end of run |
| Drafter `claims[]` schema break | Medium | Medium | Zod-validate at node exit; retry once on parse fail |
| Voice gate too strict (v1 problem) | High | Medium | Ship in `log_only` mode for 48h, then enable blocking |
| Judge correlates poorly with owner taste | Medium | Medium | Day-2 calibration: owner scores 30 golden posts blind, compare to judge, ship only if median delta less than 1 point |
| Supabase free tier hits row limit | Very Low | Low | Free tier is 500MB; runs table is tiny |
| GH Actions cron drift | Low | Low | Document UTC, allow override |
| Cost cap fires too often | Low | Medium | Day-2 review of accumulated costs across all dry runs |
| Public trace leaks unpublished draft | Low | High | Public traces only include node names + metadata, not full body, for skipped runs |

## 11. Test plan

### 11.1 Build day (Day 1)

- Unit tests on each node: input/output schemas via zod
- Integration test: full graph with fixture sources, fixture profile
- Smoke test: `pnpm pipeline --profile examples/sai-voice --dry-run` 3 times with cost capped at $0.10

### 11.2 Day 2

- Real run (not dry): `pnpm pipeline --profile examples/sai-voice` once for Mon, once for Wed, once for Fri
- Manual review of all 3 drafts and traces
- Tune gate thresholds in `brand.yaml` based on what was rejected
- Calibrate judge against golden corpus

### 11.3 Day 3

- First scheduled cron run (Sun 00:30 UTC)
- End-to-end verification: trace, draft commit, Supabase row, dashboard refresh
- Public Langfuse project link verified working in a private browser session
- README link verified

### 11.4 Definition of done for v2.0

- 3 dry runs and 3 real runs completed
- 2 of 3 drafts published from the first scheduled run
- Dashboard live, loads in under 2 seconds
- README sharp and contains: arch diagram, demo trace link, 30-minute setup
- Public Langfuse project link works without sign-in
- MIT license added
- v1 archived to `archive/v1-pipeline.ts`

## 12. Open questions resolved

| Question | Resolution |
|---|---|
| Graph runtime | LangGraph-JS |
| Tracing | Langfuse Cloud (free tier) |
| Voice positioning | Voice-agnostic engine; `examples/sai-voice` is the demo |
| Auto-post | Never |
| Brand.yaml open source | Yes, the schema; owner's example profile also public |
| Dashboard domain | `linkedin-engine.vercel.app` to start; custom domain later |
| Cost ceiling | $0.50/run hard cap, $0.25/run soft target |
| Executor | Claude Code autonomous session, owner approves at gates |

## 13. v2.1 backlog (post-launch)

- pgvector memory for source dedup beyond 4 weeks and voice exemplar retrieval
- npm package `@linkedin-engine/core`
- Two additional example profiles (founder, dev-rel)
- Engagement feedback loop (read LinkedIn analytics export, weight angles)
- Multi-channel support (Twitter thread variant)
- Self-hosted Langfuse option

---

## 14. 24-hour execution scope (locked)

The full v2 deliverable lands across 72 hours. Hour 0 to 24 is the build window; hour 24 to 72 is calibrate and ship.

### 14.1 In scope, hour 0 to 24 (MVP cut)

| Block | Deliverable | Verify |
|---|---|---|
| Repo setup | Public repo flip, MIT LICENSE, root CLAUDE.md, AGENTS.md, ARCHITECTURE.md, CONTRIBUTING.md, .github templates, monorepo skeleton (pnpm workspaces), v1 frozen at tag `v1.0.0`, v1 source moved to `archive/v1/` | `gh repo view` shows public; `git tag` shows v1.0.0; `pnpm -r ls` lists three packages |
| Example profile carve-out | `examples/sai-voice/brand.yaml` + `examples/sai-voice/README.md`; engine reads profile path from CLI arg, never hardcodes | Engine works on a stub `examples/test-voice/` profile too |
| LangGraph supervisor | `packages/engine/src/graph.ts` with five nodes wired (scout, strategist, drafter, critic, gates), parallel fan-out across mon/wed/fri | Single `pnpm pipeline --profile examples/sai-voice` produces three draft files |
| Langfuse tracing | `packages/engine/src/lib/trace.ts` wraps Anthropic SDK; one trace per run, span per node, token + cost on each span | Trace URL printed at end of run; opens in Langfuse Cloud with all spans populated |
| Fact gate (deterministic) | `packages/engine/src/gates/factGate.ts`; drafter emits `claims[]` with `source_url`; gate rejects any claim whose URL is not in `state.sources` | Unit test: synthetic draft with one fabricated URL fails the gate |
| Voice gate port | Lift `src/lib/gate.ts` from v1 into `packages/engine/src/gates/voiceGate.ts`; runs in `log_only` mode for the first 48 hours per `brand.yaml` | Gate runs, logs verdict, never blocks during hour 0 to 24 |
| Dry runs | Three `--dry-run` invocations (cost cap $0.10) on real Anthropic + Langfuse keys, all three pass | Three trace URLs; three draft files; cost row written locally |
| Public README | Top-level README rewritten: one-line pitch, one architecture diagram, link to PRD + DESIGN, demo trace link (after first dry run), 30-minute setup section | Cold read by a stranger answers what + how + cost in under 4 minutes |

### 14.2 Out of scope until hour 24, in scope hour 24 to 72

- LLM judge + 30-post golden corpus (`packages/eval`)
- Supabase schema migration + `runs` + `sources_seen` tables
- Dashboard package (`packages/dashboard` on Vercel)
- First real scheduled cron run (Sun or Wed 00:30 UTC)
- Voice gate flips from `log_only` to `blocking`
- Calibration: owner scores 30 golden posts blind; compare against judge; ship only if median delta is under 1 point

### 14.3 Reuse buckets, locked

Three buckets describe how v1 code feeds v2. The first two minimize work; the third is net new per design section 4.

**Bucket A. Lift as-is (zero edits).** Move under `archive/v1/`, re-export from v2 where useful.

- `brand.yaml` schema + zod loader (`src/lib/brand.ts` from v1)
- Voice gate logic (`src/lib/gate.ts` from v1) including banned phrases, rhythm checks, dash sanitizer
- `extractJson` tolerance helper for prose preamble around JSON
- `config/sources.yaml` RSS feed list
- `.github/workflows/cron.yml` schedule (Sun + Wed 00:30 UTC)
- `data/voice-corpus/` directory contents
- `drafts/` and `posted/` directory layout

**Bucket B. Lift and rewrap.** Keep the prompt text and schema; rewrite the runtime wrapper so each call emits a Langfuse span and writes cost into graph state.

- Scout prompt (Haiku) and RSS fallback path
- Strategist prompt (Sonnet) and pillar pinning logic
- Drafter prompt (Sonnet) and JSON output schema
- Critic prompt (Sonnet) and verdict schema

**Bucket C. Build new (no v1 equivalent).**

- `packages/engine/src/graph.ts` (LangGraph supervisor, conditional edges, parallel fan-out)
- `packages/engine/src/lib/trace.ts` (Langfuse client wrapper)
- `packages/engine/src/gates/factGate.ts` (deterministic claim verification)
- `packages/engine/src/gates/judge.ts` and `packages/eval/` (deferred to hour 24 to 72)
- `packages/engine/src/lib/db.ts` (Supabase client, deferred to hour 24 to 72)
- `packages/dashboard/` (Next.js app, deferred to hour 24 to 72)
- `examples/sai-voice/` profile carve-out

### 14.4 Drift mitigation

v1 keeps running on `main` until the v2 cutover PR merges. To prevent copy-paste drift between live v1 and v2-in-progress, the build window opens with `git tag v1.0.0` on current `main` and `git mv src/ archive/v1/src/` on the v2 branch. v2 imports from `archive/v1/` for buckets A and B. No file is referenced from two places.

### 14.5 Definition of done, hour 24

Six checks. If any fails at hour 24, the build window extends to hour 30 before scope cuts.

1. `gh repo view Imasaikiran/linkedin-engine --json visibility` returns `"PUBLIC"`.
2. `git tag --list v1.0.0` returns one row.
3. `pnpm -r run typecheck` exits 0 across all workspaces.
4. `pnpm pipeline --profile examples/sai-voice` produces three draft files or three `*.SKIPPED.md` files, each with a Langfuse trace URL embedded.
5. The Langfuse trace for each run shows one span per node (scout, strategist, drafter, critic, factGate, voiceGate) with token and cost metadata.
6. Public README loads on github.com and links to the demo trace.

---

End of design spec.
