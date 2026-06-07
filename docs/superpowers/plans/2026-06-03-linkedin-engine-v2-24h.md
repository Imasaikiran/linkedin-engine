# linkedin-engine v2 (24h MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect linkedin-engine as a public, well-structured OSS agent product: a LangGraph-JS state graph wrapping the proven v1 agents, every node traced in Langfuse, the deterministic fact gate wired, on a clean monorepo with the documentation a stranger can read in four minutes.

**Architecture:** One pnpm workspace. `packages/engine` holds the v2 engine. v1's reusable libraries (brand schema, voice gate, hallucination gate, JSON extractor, LLM wrapper) move into the engine unchanged. The four agent prompts (scout, strategist, drafter, critic) keep their text and schemas; a thin LangGraph node wrapper adds a Langfuse span and folds cost into graph state. A top-level `StateGraph` runs `scout → strategist → draft → critic →(conditional retry)→ gate → finalize`. The owner's voice moves out of the engine into `examples/sai-voice/`; the engine reads a profile path from `--profile`.

**Tech Stack:** TypeScript, Node 20, pnpm 10 workspaces, `@langchain/langgraph`, `@langfuse/tracing` + `@langfuse/otel` + `@opentelemetry/sdk-node`, `@anthropic-ai/sdk`, `zod`, `vitest`.

**Scope:** This plan covers ONLY the 24-hour MVP cut (DESIGN.md section 14.1). Out of scope here, deferred to hour 24 to 72: LLM judge + golden corpus, Supabase, the Next.js dashboard, the first real cron, flipping the voice gate to blocking. Those get their own plans.

**Deliberate deviation from DESIGN section 3.2:** DESIGN specifies three independent per-day graph runs, each with its own Langfuse trace. This 24h plan keeps v1's proven single-run shape (one graph run, all three days, one trace per run with day-tagged spans), reusing the orchestrator's parallel internals via `Promise.all`. Per-day independent traces move to the v2.1 backlog. Rationale: lowest-risk reuse of battle-tested v1 fan-out inside the 24h window. The owner approved "reuse v1 components."

---

## File Structure

Target layout after this plan (only paths this plan creates or moves are listed):

```
linkedin-engine/
├── CLAUDE.md                         # NEW: rules for AI agents (dos/don'ts, voice law)
├── AGENTS.md                         # NEW: pointer to CLAUDE.md for non-Claude tools
├── ARCHITECTURE.md                   # NEW: the graph, nodes, data flow, one diagram
├── CONTRIBUTING.md                   # NEW: how to fork, add a profile, run, PR
├── CODE_OF_CONDUCT.md                # NEW: Contributor Covenant short form
├── SECURITY.md                       # NEW: how to report, what secrets to never commit
├── LICENSE                           # NEW: MIT
├── README.md                         # REWRITE: recruiter-readable, arch diagram, setup
├── package.json                      # REWRITE: workspace root, scripts delegate to engine
├── pnpm-workspace.yaml               # NEW: packages/* glob
├── tsconfig.base.json                # NEW: shared compiler options
├── .gitignore                        # MODIFY: add packages/**/dist, .turbo, coverage
├── .env.example                      # REWRITE: ANTHROPIC + LANGFUSE keys, profile path
├── .github/
│   ├── workflows/cron.yml            # MOVE+EDIT from pipeline.yml: pnpm --filter engine
│   ├── workflows/ci.yml              # NEW: typecheck + lint + vitest on push/PR
│   ├── ISSUE_TEMPLATE/bug_report.yml         # NEW
│   ├── ISSUE_TEMPLATE/profile_request.yml    # NEW
│   ├── ISSUE_TEMPLATE/config.yml             # NEW
│   ├── PULL_REQUEST_TEMPLATE.md      # NEW
│   └── CODEOWNERS                    # NEW
├── docs/
│   ├── v2/{PRD.md,DESIGN.md}         # already present
│   └── superpowers/plans/            # this plan
├── examples/
│   ├── _template/
│   │   ├── brand.yaml                # NEW: blank voice-agnostic starter
│   │   └── README.md                 # NEW: how to fill it in
│   └── sai-voice/
│       ├── brand.yaml                # MOVE from repo-root brand.yaml, reframed identity
│       ├── README.md                 # NEW: "demo profile, fork to make your own"
│       └── voice-corpus/external/    # MOVE from data/voice-corpus/external
├── config/
│   └── sources.yaml                  # already present (shared RSS feeds)
└── packages/
    └── engine/
        ├── package.json              # NEW: name @linkedin-engine/engine
        ├── tsconfig.json             # NEW: extends ../../tsconfig.base.json
        ├── vitest.config.ts          # MOVE from repo root
        ├── src/
        │   ├── cli.ts                # NEW: parse --profile/--dry-run, run graph, write drafts
        │   ├── state.ts              # NEW: GraphState Annotation.Root
        │   ├── graph.ts              # NEW: StateGraph wiring + conditional retry edge
        │   ├── run.ts                # NEW: builds initial state, invokes graph, returns summary
        │   ├── nodes/
        │   │   ├── _node.ts          # NEW: shared node()/observe wrapper helper
        │   │   ├── scout.node.ts     # NEW: wraps runScout
        │   │   ├── strategist.node.ts# NEW: wraps runStrategist
        │   │   ├── draft.node.ts     # NEW: wraps runDrafter (3-day fan-out)
        │   │   ├── critic.node.ts    # NEW: wraps runCritic + surgical retry
        │   │   └── gate.node.ts      # NEW: runs factGate + voiceGate per day
        │   ├── gates/
        │   │   ├── factGate.ts       # NEW: thin wrapper over runHallucinationGate
        │   │   └── voiceGate.ts      # NEW: thin wrapper over runVoiceGate (log_only aware)
        │   ├── lib/
        │   │   ├── trace.ts          # NEW: Langfuse OTel init + withTrace + observeLlm + flush
        │   │   ├── profile.ts        # NEW: loadProfile(profileDir) -> { brand, voiceCorpusDir }
        │   │   ├── brand.ts          # MOVE from src/lib/brand.ts (unchanged)
        │   │   ├── gate.ts           # MOVE from src/lib/gate.ts (unchanged)
        │   │   ├── schema.ts         # MOVE from src/lib/schema.ts (unchanged)
        │   │   ├── llm.ts            # MOVE from src/lib/llm.ts (+ optional trace hook)
        │   │   ├── log.ts            # MOVE from src/lib/log.ts (unchanged)
        │   │   ├── rss.ts            # MOVE (unchanged)
        │   │   ├── fetch.ts          # MOVE (unchanged)
        │   │   └── embed.ts          # MOVE (unchanged)
        │   ├── agents/               # MOVE src/agents/* (scout/strategist/drafter/critic)
        │   └── legacy/
        │       ├── orchestrator.ts   # MOVE src/agents/orchestrator.ts (frozen, one cycle)
        │       └── agentic-pipeline.ts # MOVE src/agentic-pipeline.ts (frozen, one cycle)
        └── tests/                    # MOVE src tests + NEW node/gate/graph/profile tests
```

**Why this shape:** Reusable libs become first-class engine files (not imported across an `archive/` boundary, which pnpm workspaces make awkward). The replaced supervisor (`orchestrator.ts`, `agentic-pipeline.ts`) lives under `legacy/` for one release cycle. The git tag `v1.0.0` is the canonical frozen v1; the README links to it. Each new file has one job and stays small enough to hold in context.

---

# PHASE A — Public repo + structure (hours 0 to 6)

Phase A produces a clean, public, well-documented repo even before the engine changes. It ships standalone.

## Task A1: Create the LICENSE and tag v1 on main

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Confirm clean tree and current branch**

Run: `cd "$(git rev-parse --show-toplevel)" && git status --short && git branch --show-current`
Expected: only `docs/v2/...` already committed; working tree otherwise clean; branch `main`.

- [ ] **Step 2: Write the MIT LICENSE**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 Sai Kiran

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Commit LICENSE on main**

```bash
git add LICENSE
git commit -m "chore: add MIT LICENSE"
```

- [ ] **Step 4: Tag v1.0.0 on main (freezes the v1 reference)**

```bash
git tag -a v1.0.0 -m "linkedin-engine v1: hand-rolled 6-stage agentic pipeline"
git tag --list v1.0.0
```
Expected: prints `v1.0.0`.

- [ ] **Step 5: Create the v2 working branch**

```bash
git checkout -b v2-langgraph
git branch --show-current
```
Expected: prints `v2-langgraph`. All remaining tasks happen here.

## Task A2: Flip the repo public (GATE 1 — owner pre-approved)

**Files:** none (GitHub state change)

- [ ] **Step 1: Verify no secrets exist in history before going public**

Run:
```bash
git log --all -p | grep -iE "sk-ant-[A-Za-z0-9_-]{20,}|LANGFUSE_SECRET_KEY=[A-Za-z0-9]{10,}|SUPABASE_SERVICE_ROLE=[A-Za-z0-9]{10,}|pa-[A-Za-z0-9]{20,}" | head -5
```
Expected: NO output. If any line prints, STOP and report to the owner before flipping. Do not proceed.

- [ ] **Step 2: Push main, the tag, and the branch**

```bash
git push origin main
git push origin v1.0.0
git push -u origin v2-langgraph
```

- [ ] **Step 3: Flip visibility to public**

```bash
gh repo edit Imasaikiran/linkedin-engine --visibility public --accept-visibility-change-consequences
gh repo view Imasaikiran/linkedin-engine --json visibility -q .visibility
```
Expected: prints `PUBLIC`.

- [ ] **Step 4: Set repo description and topics for discoverability**

```bash
gh repo edit Imasaikiran/linkedin-engine \
  --description "Open-source agent that writes 3 voice-faithful LinkedIn drafts a week. LangGraph + Anthropic + Langfuse. Every run fully traced." \
  --add-topic langgraph --add-topic anthropic --add-topic langfuse \
  --add-topic ai-agents --add-topic typescript --add-topic llm
```

## Task A3: Author CLAUDE.md (the rules file)

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

This is the contract every agent (and human) follows in this repo. Create `CLAUDE.md`:

```markdown
# CLAUDE.md — Rules for working in linkedin-engine

This file is the contract. Claude Code, other agents, and humans follow it.

## What this project is

An open-source agent that writes three LinkedIn drafts a week in a configured
voice, grounded in real sources, with every run traced in Langfuse. The engine
is voice-agnostic. A person's voice lives in a profile under `examples/`, never
in engine code.

## The voice law (non-negotiable)

The product's whole point is voice fidelity. These rules apply to generated
posts AND to everything you write in this repo (docs, commits, comments, PRs):

- No em dashes. No en dashes. Use a regular hyphen or rewrite the sentence.
- No AI-slop phrases: game-changer, thought leader, deep dive, delve, leverage,
  synergy, ecosystem, unpack, unlock, "Let that sink in", "Here's the thing".
- No slop openers: "I recently", "Excited to share", "Today I want to share".
- Prefer concrete nouns and verbs. Short sentences. No hedging.

The deterministic voice gate (`packages/engine/src/gates/voiceGate.ts`) enforces
these on posts. You enforce them on yourself everywhere else.

## Architecture rules

- The engine never hardcodes a profile. Profile path comes from `--profile`.
- `brand.yaml` is the single source of truth for a profile's voice and cadence.
  To change strategy you edit the profile's `brand.yaml`, not code.
- Every LLM call goes through `observeLlm()` so it lands in a Langfuse span with
  token and cost metadata. No raw `client.messages.create` outside `lib/llm.ts`.
- Gates are deterministic. They never call an LLM. They never throw on a bad
  draft; they return `{ pass, ... }` and the caller decides.
- Cost is accumulated on graph state. The run aborts if it crosses the profile's
  `budgets.cost_usd_per_run` cap.

## Dos

- Do reuse v1 logic that already works (voice gate, hallucination gate, JSON
  extraction, brand schema). It carries weeks of tuning.
- Do write a failing test first, then the code (TDD).
- Do keep files small and single-purpose.
- Do commit per task with a Conventional Commits message.

## Don'ts

- Don't auto-post to LinkedIn. The engine writes drafts; a human posts. Ever.
- Don't add a feature that wasn't asked for. YAGNI.
- Don't widen a module's public surface to make a test easier; use a seam.
- Don't commit secrets. Keys live in `.env` (gitignored) and GitHub secrets.
- Don't edit files under `packages/engine/src/legacy/`. They are frozen v1.

## Commands

- Install: `pnpm install`
- Typecheck everything: `pnpm -r run typecheck`
- Test the engine: `pnpm --filter @linkedin-engine/engine test`
- Run the pipeline: `pnpm pipeline --profile examples/sai-voice`
- Dry run (cost-capped, no publish): `pnpm pipeline --profile examples/sai-voice --dry-run`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md as the repo contract"
```

## Task A4: Author AGENTS.md, ARCHITECTURE.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md

**Files:**
- Create: `AGENTS.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`

- [ ] **Step 1: Write AGENTS.md (pointer for non-Claude tools)**

Create `AGENTS.md`:

```markdown
# AGENTS.md

This repo's working rules for any AI coding agent live in [CLAUDE.md](./CLAUDE.md).
Cursor, Copilot, Codex, Gemini, and others: read CLAUDE.md first and follow it.
The voice law in that file applies to every line you write here, not just posts.
```

- [ ] **Step 2: Write ARCHITECTURE.md (the map)**

Create `ARCHITECTURE.md`:

````markdown
# Architecture

linkedin-engine turns a voice profile into three publishable LinkedIn drafts a
week. The work is a graph of small, single-purpose nodes. Each node reads the
shared `brand.yaml`, does one job, and writes its result onto graph state. Every
model call is a Langfuse span, so a whole run is one readable trace.

## The graph

```
brand.yaml (profile, the single source of truth)
     |
     v
  scout  ->  strategist  ->  draft (x3)  ->  critic (x3)
   Haiku       Sonnet          Sonnet          Sonnet
                                                  |
                                   approve / fix-soft |  fix-block (retry <= 2)
                                                  v                |
                                              gate (x3) <----------+
                                          fact + voice, deterministic
                                                  |
                                                  v
                                  drafts/YYYY-WW/{mon,wed,fri}.md
                                          (or *.SKIPPED.md)
                                                  |
                                                  v
                          Langfuse: one trace per run, one span per node
```

## Nodes

| Node | Model | Job |
|---|---|---|
| scout | Haiku | Find sources from the last seven days (web search, RSS fallback). |
| strategist | Sonnet | Pick one angle per day, pinned to that day's pillar in `brand.yaml`. |
| draft | Sonnet | Write three drafts in parallel; each emits `claims[]` with source URLs. |
| critic | Sonnet | Read each draft like a target reader; return approve / fix-soft / fix-block. |
| gate | none | Deterministic. Fact gate checks every claim URL is a real scouted source. Voice gate checks rhythm, banned phrases, dashes. |

## Why a graph

The hard problem in agent-written content is knowing when NOT to publish. A graph
makes the decision points explicit: the conditional edge from `critic` back to
`draft` is the retry loop; the gates are the publish/skip fork. You can see the
branch in the trace.

## Reuse from v1

The voice gate, the hallucination (fact) gate, the brand schema, and the JSON
extractor are lifted from v1 unchanged. They carry weeks of tuning. The agent
prompts are lifted too; only their runtime wrapper changed, to add a span.

## Layout

- `packages/engine/src/graph.ts` — the StateGraph wiring.
- `packages/engine/src/state.ts` — the shared state shape.
- `packages/engine/src/nodes/` — one file per node.
- `packages/engine/src/gates/` — deterministic gates.
- `packages/engine/src/lib/` — brand, trace, profile, llm, schema.
- `examples/` — voice profiles. `sai-voice` is the demo; `_template` is blank.
- `packages/engine/src/legacy/` — frozen v1 supervisor, kept one release cycle.
````

- [ ] **Step 3: Write CONTRIBUTING.md**

Create `CONTRIBUTING.md`:

```markdown
# Contributing

Thanks for looking. This is a small, complete, real agent product. It should be
readable in an afternoon and runnable in thirty minutes.

## Setup

1. `pnpm install` (Node 20+, pnpm 10+).
2. `cp .env.example .env` and fill in your Anthropic and Langfuse keys.
3. `pnpm pipeline --profile examples/sai-voice --dry-run` to see a run end to end.

## Making your own voice profile

1. `cp -r examples/_template examples/my-voice`.
2. Edit `examples/my-voice/brand.yaml`: your role, your banned phrases, your
   weekly cadence.
3. `pnpm pipeline --profile examples/my-voice`.

## The voice law

Read [CLAUDE.md](./CLAUDE.md). No em dashes, no en dashes, no AI-slop phrases,
anywhere, including this file and your commit messages.

## Pull requests

- One change per PR. Keep it focused.
- `pnpm -r run typecheck` and `pnpm --filter @linkedin-engine/engine test` must pass.
- Write a test for new behavior. Failing test first.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## What we will not merge

- Auto-posting to LinkedIn.
- A second channel (Twitter, Substack) in the engine core. Propose it as a profile
  or a plugin first.
- A feature with no test.
```

- [ ] **Step 4: Write CODE_OF_CONDUCT.md (Contributor Covenant short form)**

Create `CODE_OF_CONDUCT.md`:

```markdown
# Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/),
version 2.1. Be respectful. Assume good faith. No harassment.

Report unacceptable behavior to the maintainer via a GitHub issue marked
private, or by email at the address on the maintainer's GitHub profile.
```

- [ ] **Step 5: Write SECURITY.md**

Create `SECURITY.md`:

```markdown
# Security

## Reporting a vulnerability

Open a GitHub security advisory (Security tab -> Report a vulnerability) or email
the maintainer. Do not open a public issue for a security report.

## Secrets

This repo never commits secrets. API keys live in `.env` (gitignored) locally and
in GitHub Actions repository secrets in CI. The public Langfuse trace for the demo
profile exposes node names, token counts, and cost only. It never exposes the body
of a draft that was skipped.
```

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md ARCHITECTURE.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md
git commit -m "docs: add architecture, contributing, conduct, security guides"
```

## Task A5: GitHub issue templates, PR template, CODEOWNERS

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/profile_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`

- [ ] **Step 1: Bug report form**

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: A run did something wrong
labels: [bug]
body:
  - type: textarea
    id: what
    attributes:
      label: What happened
      description: Include the Langfuse trace URL if you have one.
    validations:
      required: true
  - type: input
    id: profile
    attributes:
      label: Profile
      placeholder: examples/sai-voice
  - type: textarea
    id: expected
    attributes:
      label: What you expected
  - type: textarea
    id: logs
    attributes:
      label: Relevant log output
      render: shell
```

- [ ] **Step 2: Profile request form**

Create `.github/ISSUE_TEMPLATE/profile_request.yml`:

```yaml
name: New example profile
description: Propose a new voice profile under examples/
labels: [profile]
body:
  - type: input
    id: persona
    attributes:
      label: Whose voice
      placeholder: founder, dev-rel, researcher
    validations:
      required: true
  - type: textarea
    id: cadence
    attributes:
      label: Weekly cadence
      description: What kind of post each day (Mon/Wed/Fri).
```

- [ ] **Step 3: Issue template config (point general questions to discussions)**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Question or idea
    url: https://github.com/Imasaikiran/linkedin-engine/discussions
    about: Ask a question or float an idea before filing an issue.
```

- [ ] **Step 4: PR template**

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## What this changes

<!-- One or two sentences. -->

## Why

<!-- Link the issue if there is one. -->

## Checklist

- [ ] `pnpm -r run typecheck` passes
- [ ] `pnpm --filter @linkedin-engine/engine test` passes
- [ ] New behavior has a test
- [ ] No em dashes, no en dashes, no AI-slop phrases (the voice law)
- [ ] No secrets committed
```

- [ ] **Step 5: CODEOWNERS**

Create `.github/CODEOWNERS`:

```
* @Imasaikiran
```

- [ ] **Step 6: Commit**

```bash
git add .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md .github/CODEOWNERS
git commit -m "chore: add issue forms, PR template, CODEOWNERS"
```

## Task A6: Monorepo scaffold (pnpm workspace) — move v1 into packages/engine

This task only MOVES files and wires the workspace. No engine logic changes yet. After it, `pnpm -r run typecheck` must still pass exactly as before, proving the move was lossless.

**Files:**
- Create: `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Move: `src/` -> `packages/engine/src/`, `tests/` -> `packages/engine/tests/`, `vitest.config.ts` -> `packages/engine/vitest.config.ts`
- Modify: root `package.json`, root `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Create the workspace file**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create the shared tsconfig base**

Create `tsconfig.base.json` (copy the compiler options from the existing root `tsconfig.json`; read it first to match exactly, then generalize paths):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```
Note: if the existing root `tsconfig.json` differs, prefer its values. The point is one shared base.

- [ ] **Step 3: Move source, tests, vitest config into the engine package**

```bash
mkdir -p packages/engine
git mv src packages/engine/src
git mv tests packages/engine/tests
git mv vitest.config.ts packages/engine/vitest.config.ts
```

- [ ] **Step 4: Move the legacy supervisor files under legacy/**

```bash
mkdir -p packages/engine/src/legacy
git mv packages/engine/src/agents/orchestrator.ts packages/engine/src/legacy/orchestrator.ts
git mv packages/engine/src/agentic-pipeline.ts packages/engine/src/legacy/agentic-pipeline.ts
```

Then fix the import paths inside the two moved files (their relative depth changed by one level): in `legacy/orchestrator.ts` and `legacy/agentic-pipeline.ts`, change `from '../lib/` to `from '../lib/` is now wrong — they moved from `src/agents/` and `src/` respectively into `src/legacy/`. Update:
- `legacy/orchestrator.ts`: `'../lib/...'` stays `'../lib/...'` (was in `agents/`, now in `legacy/`, same depth from `src/`), and `'./scout.js'` becomes `'../agents/scout.js'` (and the same for strategist, drafter, critic).
- `legacy/agentic-pipeline.ts`: `'./lib/...'` becomes `'../lib/...'`, and `'./agents/orchestrator.js'` becomes `'./orchestrator.js'`.

Run typecheck after to confirm (Step 8).

- [ ] **Step 5: Create the engine package.json**

Create `packages/engine/package.json` (lift dependencies from the current root `package.json`; read it first):

```json
{
  "name": "@linkedin-engine/engine",
  "version": "2.0.0-mvp",
  "type": "module",
  "private": true,
  "scripts": {
    "pipeline": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.90.0",
    "@langchain/langgraph": "^0.2.0",
    "@langfuse/otel": "^4.0.0",
    "@langfuse/tracing": "^4.0.0",
    "@opentelemetry/sdk-node": "^0.205.0",
    "dayjs": "^1.11.20",
    "pino": "^10.3.1",
    "rss-parser": "^3.13.0",
    "yaml": "^2.8.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@vitest/coverage-v8": "^4.1.4",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```
Note: pin `@langchain/langgraph`, `@langfuse/*`, and `@opentelemetry/sdk-node` to the latest versions `pnpm add` resolves at install time (Step 7); the carets above are placeholders to be replaced by the resolved versions.

- [ ] **Step 6: Create the engine tsconfig and rewrite the root package.json + tsconfig**

Create `packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Rewrite root `package.json` to a workspace root that delegates:

```json
{
  "name": "linkedin-engine",
  "version": "2.0.0-mvp",
  "type": "module",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "pipeline": "pnpm --filter @linkedin-engine/engine pipeline",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r run typecheck"
  }
}
```

Rewrite root `tsconfig.json` to a thin solution file:

```json
{
  "files": [],
  "references": [{ "path": "packages/engine" }]
}
```

- [ ] **Step 7: Install and add the new dependencies**

```bash
pnpm install
pnpm --filter @linkedin-engine/engine add @langchain/langgraph @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```
Then update `packages/engine/package.json` dependency versions to whatever pnpm resolved (replace the placeholder carets).

- [ ] **Step 8: Verify the move was lossless**

Run: `pnpm -r run typecheck`
Expected: exits 0 (same as before the move). If imports break, fix the relative paths flagged in Step 4 until green.

Run: `pnpm --filter @linkedin-engine/engine test`
Expected: the existing v1 test suite passes (same count as before the move).

- [ ] **Step 9: Update .gitignore**

Add to `.gitignore`:

```
packages/**/dist/
.turbo/
*.tsbuildinfo
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move v1 engine into packages/engine workspace (lossless)"
```

---

# PHASE B — Engine v2 (hours 6 to 18)

Phase B adds the graph, the tracing, the fact-gate wiring, and the profile carve-out. It reuses v1 internals.

## Task B1: Carve the voice profile out of the engine into examples/

The engine must stop hardcoding the owner's voice. Move `brand.yaml` to `examples/sai-voice/`, reframe its identity from job-hunt to product-builder, and create a blank template.

**Files:**
- Move: repo-root `brand.yaml` -> `examples/sai-voice/brand.yaml`
- Move: `data/voice-corpus/external/` -> `examples/sai-voice/voice-corpus/external/`
- Create: `examples/sai-voice/README.md`, `examples/_template/brand.yaml`, `examples/_template/README.md`
- Create: `packages/engine/src/lib/profile.ts`
- Test: `packages/engine/tests/lib/profile.test.ts`

- [ ] **Step 1: Move the profile files**

```bash
mkdir -p examples/sai-voice
git mv brand.yaml examples/sai-voice/brand.yaml
mkdir -p examples/sai-voice/voice-corpus
git mv data/voice-corpus/external examples/sai-voice/voice-corpus/external
```

- [ ] **Step 2: Reframe the identity block in examples/sai-voice/brand.yaml**

Read `examples/sai-voice/brand.yaml`. Replace the `identity` block's job-hunt framing with product-builder framing. Change:
```yaml
identity:
  role: "Senior AI PM building 0→1 products at AI startups"
  goal: "Be known for clear, honest writing about building with LLMs"
```
to:
```yaml
identity:
  role: "Builder writing in public about shipping AI agent products"
  goal: "Be known for clear, honest writing about building with LLMs"
```
Leave `audience`, `voice`, `cadence`, `engagement`, `sources`, `agents`, `budgets`, `quality` unchanged. Also update `sources.rss_config` if it points at `config/sources.yaml` (it stays valid; the file is still at repo root) and `sources.voice_corpus.dir` to `voice-corpus/external` (now relative to the profile dir).

- [ ] **Step 3: Write the demo profile README**

Create `examples/sai-voice/README.md`:

```markdown
# sai-voice (demo profile)

This is the public demo profile. Its traces are public. To make your own voice,
copy `examples/_template` and edit it:

    cp -r examples/_template examples/my-voice

Then run:

    pnpm pipeline --profile examples/my-voice

`brand.yaml` is the single source of truth: your role, your banned phrases, your
weekly cadence. Edit that file, not the engine.
```

- [ ] **Step 4: Write the blank template**

Create `examples/_template/brand.yaml` by copying `examples/sai-voice/brand.yaml` and blanking the person-specific fields (keep structure and sane defaults; empty the banned lists to short generic sets, set role/goal/audience to placeholders like `"Your one-line role"`). Keep `voice.must_not_have.em_dashes: true`, `en_dashes: true`, the rhythm numbers, and the three-day cadence skeleton.

Create `examples/_template/README.md`:

```markdown
# Voice profile template

Copy this directory, rename it, and edit `brand.yaml`. Three things to change first:

1. `identity.role` — what you do, one line.
2. `voice.must_not_have.banned_phrases` — words you never use.
3. `cadence.{mon,wed,fri}.pillar` — what kind of post each day is.

The defaults for everything else are sane. Run with:

    pnpm pipeline --profile examples/your-folder
```

- [ ] **Step 5: Write the failing test for the profile loader**

Create `packages/engine/tests/lib/profile.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadProfile } from "../../src/lib/profile.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("loadProfile", () => {
  it("loads the sai-voice brand and resolves its voice corpus dir", () => {
    const dir = path.join(REPO_ROOT, "examples/sai-voice");
    const p = loadProfile(dir);
    expect(p.brand.identity.role.length).toBeGreaterThan(0);
    expect(p.profilePath).toBe(dir);
    expect(p.voiceCorpusDir).toBe(path.join(dir, "voice-corpus/external"));
  });

  it("throws a clear error when the profile dir has no brand.yaml", () => {
    expect(() => loadProfile(path.join(REPO_ROOT, "examples/does-not-exist")))
      .toThrow(/brand\.yaml/);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/profile.test.ts`
Expected: FAIL, `loadProfile` not found.

- [ ] **Step 7: Implement the profile loader**

Create `packages/engine/src/lib/profile.ts`:

```typescript
import path from "node:path";
import { loadBrand, type Brand } from "./brand.js";

export interface Profile {
  /** Absolute path to the profile directory (e.g. examples/sai-voice). */
  profilePath: string;
  /** Validated brand config from <profilePath>/brand.yaml. */
  brand: Brand;
  /** Absolute path to the profile's external voice corpus dir. */
  voiceCorpusDir: string;
}

/**
 * Load a voice profile from a directory containing brand.yaml. The engine never
 * hardcodes a profile; callers pass the directory (from the --profile CLI arg).
 */
export function loadProfile(profileDir: string): Profile {
  const profilePath = path.resolve(profileDir);
  const brand = loadBrand(path.join(profilePath, "brand.yaml"));
  const voiceCorpusDir = path.join(profilePath, brand.sources.voice_corpus.dir);
  return { profilePath, brand, voiceCorpusDir };
}
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/profile.test.ts`
Expected: PASS (both cases).

- [ ] **Step 9: Commit**

```bash
git add examples packages/engine/src/lib/profile.ts packages/engine/tests/lib/profile.test.ts
git add -u
git commit -m "feat(profile): carve voice out of engine into examples/, add loadProfile"
```

## Task B2: Langfuse tracing wrapper (lib/trace.ts)

All Langfuse specifics live in one file. If keys are absent (dry run, CI without secrets), it degrades to a no-op so drafts still write (PRD risk row: traces are best-effort, never blocking).

**Files:**
- Create: `packages/engine/src/lib/trace.ts`
- Test: `packages/engine/tests/lib/trace.test.ts`

- [ ] **Step 1: Write the failing test (no-op path, no keys)**

Create `packages/engine/tests/lib/trace.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { initTracing, withTrace, observe, traceUrl, flushTracing } from "../../src/lib/trace.js";

describe("trace (no-op when keys absent)", () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it("withTrace runs the body and returns its value even with tracing disabled", async () => {
    initTracing();
    const out = await withTrace({ runId: "r1", name: "run", metadata: {} }, async () => {
      return observe("scout", { model: "x" }, async () => 42);
    });
    expect(out).toBe(42);
  });

  it("traceUrl returns undefined when tracing is disabled", () => {
    initTracing();
    expect(traceUrl("r1")).toBeUndefined();
  });

  it("flushTracing resolves without throwing when disabled", async () => {
    await expect(flushTracing()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/trace.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the trace wrapper**

Create `packages/engine/src/lib/trace.ts`:

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  startActiveObservation,
} from "@langfuse/tracing";

let sdk: NodeSDK | undefined;
let enabled = false;
let host = "https://cloud.langfuse.com";

/**
 * Initialize Langfuse tracing if keys are present. Safe to call once at startup.
 * With no keys, tracing is a no-op and every wrapper below just runs its body.
 */
export function initTracing(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  host = process.env.LANGFUSE_HOST ?? host;
  if (!publicKey || !secretKey) {
    enabled = false;
    return;
  }
  const spanProcessor = new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl: host });
  sdk = new NodeSDK({ spanProcessor });
  sdk.start();
  enabled = true;
}

export interface TraceMeta {
  /** Run UUID. Also used to build the public trace URL. */
  runId: string;
  name: string;
  metadata: Record<string, unknown>;
}

/** Open one trace for a whole run. The body's return value is passed through. */
export async function withTrace<T>(meta: TraceMeta, body: () => Promise<T>): Promise<T> {
  if (!enabled) return body();
  return propagateAttributes(
    { traceName: meta.name, metadata: { runId: meta.runId, ...meta.metadata } },
    body,
  );
}

export interface ObserveLlmInfo {
  model: string;
  input?: unknown;
}
export interface ObserveLlmResult {
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Wrap one model call as a Langfuse generation span. `body` returns both the
 * value the caller wants and the usage to record. With tracing disabled, the
 * body still runs and its value is returned; usage is dropped.
 */
export async function observe<T>(
  name: string,
  info: ObserveLlmInfo,
  body: () => Promise<{ value: T; usage?: ObserveLlmResult }>,
): Promise<T> {
  if (!enabled) {
    const { value } = await body();
    return value;
  }
  return startActiveObservation(
    name,
    async (span) => {
      span.update({ model: info.model, input: info.input });
      const { value, usage } = await body();
      span.update({
        output: usage?.output,
        usageDetails:
          usage?.inputTokens !== undefined
            ? {
                input: usage.inputTokens,
                output: usage.outputTokens ?? 0,
                total: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
              }
            : undefined,
        costDetails: usage?.costUsd !== undefined ? { total: usage.costUsd } : undefined,
      });
      return value;
    },
    { asType: "generation" },
  );
}

/** Build the public trace URL for a run id, or undefined when disabled. */
export function traceUrl(runId: string): string | undefined {
  if (!enabled) return undefined;
  return `${host}/trace/${runId}`;
}

/** Flush pending spans. Call once at the end of a run. Never throws. */
export async function flushTracing(): Promise<void> {
  if (!enabled || !sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // best effort; tracing is never allowed to fail a run
  }
}
```
Note: if the installed `@langfuse/tracing` exposes a different span-usage field name than `usageDetails`/`costDetails`, adapt to the installed types (check `node_modules/@langfuse/tracing` typings). The boundary (`observe`) is the only place that knows the SDK shape.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/trace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/lib/trace.ts packages/engine/tests/lib/trace.test.ts
git commit -m "feat(trace): Langfuse OTel wrapper, no-op without keys"
```

## Task B3: Graph state shape (state.ts)

**Files:**
- Create: `packages/engine/src/state.ts`
- Test: `packages/engine/tests/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/tests/state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GraphAnnotation, type GraphStateValue } from "../src/state.js";

describe("GraphAnnotation", () => {
  it("has a spec with all engine channels", () => {
    const channels = Object.keys(GraphAnnotation.spec);
    for (const key of ["runId", "week", "profile", "sources", "angles", "drafts", "verdicts", "retries", "costUsd", "days"]) {
      expect(channels).toContain(key);
    }
  });

  it("the costUsd reducer sums increments", () => {
    const reduce = GraphAnnotation.spec.costUsd.reducer!;
    expect(reduce(0.1, 0.2)).toBeCloseTo(0.3);
  });

  it("typed value compiles", () => {
    const v: Partial<GraphStateValue> = { runId: "r1", costUsd: 0 };
    expect(v.runId).toBe("r1");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/state.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the state annotation**

Create `packages/engine/src/state.ts`:

```typescript
import { Annotation } from "@langchain/langgraph";
import type { Brand } from "./lib/brand.js";
import type { ScoutOutput } from "./agents/scout.js";
import type { StrategistAngle } from "./agents/strategist.js";
import type { CriticVerdict } from "./agents/critic.js";
import type { Draft } from "./lib/schema.js";

export type Day = "mon" | "wed" | "fri";

export interface ProfileRef {
  /** e.g. "examples/sai-voice" (as passed on the CLI). */
  name: string;
  path: string;
  brand: Brand;
  voiceCorpusDir: string;
}

export interface DayOutcome {
  day: Day;
  status: "published" | "skipped";
  reasonClass?: string;
  reason?: string;
  pillar?: string;
  retries: number;
  wordCount?: number;
  charCount?: number;
}

/** Replace-on-write reducer (last write wins). Used for single-value channels. */
function lastWins<T>(_current: T, update: T): T {
  return update;
}

export const GraphAnnotation = Annotation.Root({
  runId: Annotation<string>({ reducer: lastWins, default: () => "" }),
  week: Annotation<string>({ reducer: lastWins, default: () => "" }),
  dryRun: Annotation<boolean>({ reducer: lastWins, default: () => false }),
  profile: Annotation<ProfileRef>({ reducer: lastWins }),
  scout: Annotation<ScoutOutput | undefined>({ reducer: lastWins, default: () => undefined }),
  sources: Annotation<{ url: string; body: string }[]>({ reducer: lastWins, default: () => [] }),
  angles: Annotation<StrategistAngle[]>({ reducer: lastWins, default: () => [] }),
  drafts: Annotation<Record<Day, Draft | undefined>>({
    reducer: (c, u) => ({ ...c, ...u }),
    default: () => ({ mon: undefined, wed: undefined, fri: undefined }),
  }),
  verdicts: Annotation<Record<Day, CriticVerdict | undefined>>({
    reducer: (c, u) => ({ ...c, ...u }),
    default: () => ({ mon: undefined, wed: undefined, fri: undefined }),
  }),
  retries: Annotation<Record<Day, number>>({
    reducer: (c, u) => ({ ...c, ...u }),
    default: () => ({ mon: 0, wed: 0, fri: 0 }),
  }),
  retryPass: Annotation<number>({ reducer: lastWins, default: () => 0 }),
  costUsd: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
  days: Annotation<DayOutcome[]>({ reducer: (c, u) => c.concat(u), default: () => [] }),
  aborted: Annotation<boolean>({ reducer: lastWins, default: () => false }),
  abortReason: Annotation<string | undefined>({ reducer: lastWins, default: () => undefined }),
});

export type GraphStateValue = typeof GraphAnnotation.State;
```
Note: the `costUsd` reducer SUMS (every node adds its increment); all other scalars are last-wins; `drafts`/`verdicts`/`retries` merge by day; `days` concatenates. If `ScoutOutput`, `StrategistAngle`, or `CriticVerdict` are not exported from their agent modules, add the `export` keyword to those type declarations in Task B-prep (they are already exported per v1; verify with typecheck).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/state.ts packages/engine/tests/state.test.ts
git commit -m "feat(graph): define GraphState annotation"
```

## Task B4: Node wrapper + scout/strategist nodes

The shared `node()` helper records a Langfuse generation around a unit of work and folds its cost into state. Each node file stays tiny: adapt v1 input/output, call the wrapped agent, return a state patch.

**Files:**
- Create: `packages/engine/src/nodes/_node.ts`, `packages/engine/src/nodes/scout.node.ts`, `packages/engine/src/nodes/strategist.node.ts`
- Test: `packages/engine/tests/nodes/scout.node.test.ts`

- [ ] **Step 1: Implement the shared node helper**

Create `packages/engine/src/nodes/_node.ts`:

```typescript
import { observe } from "../lib/trace.js";

/**
 * Wrap an agent call as a traced unit. `fn` returns the agent's value plus its
 * cost; the helper records the generation span and hands back { value, costUsd }
 * so the node can fold cost into the graph state's summing channel.
 */
export async function traced<T>(
  name: string,
  model: string,
  input: unknown,
  fn: () => Promise<{ value: T; costUsd: number; inputTokens?: number; outputTokens?: number; output?: unknown }>,
): Promise<{ value: T; costUsd: number }> {
  let costUsd = 0;
  const value = await observe<T>(name, { model, input }, async () => {
    const r = await fn();
    costUsd = r.costUsd;
    return {
      value: r.value,
      usage: {
        output: r.output,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
      },
    };
  });
  return { value, costUsd };
}
```

- [ ] **Step 2: Write the failing test for the scout node (mocked agent)**

Create `packages/engine/tests/nodes/scout.node.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/scout.js", () => ({
  runScout: vi.fn(async () => ({
    source: "web_search",
    trending_topics: [{ url: "https://a.test/1", summary: "s1" }],
    recent_launches: [{ url: "https://b.test/2", summary: "s2" }],
    cost_usd: 0.01,
  })),
}));

import { scoutNode } from "../../src/nodes/scout.node.js";
import { loadProfile } from "../../src/lib/profile.js";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("scoutNode", () => {
  it("returns a state patch with sources, scout, and summed cost", async () => {
    const profileDir = path.join(REPO_ROOT, "examples/sai-voice");
    const p = loadProfile(profileDir);
    const patch = await scoutNode({
      profile: { name: "examples/sai-voice", path: p.profilePath, brand: p.brand, voiceCorpusDir: p.voiceCorpusDir },
      // other state fields unused by scout
    } as any);
    expect(patch.costUsd).toBeCloseTo(0.01);
    expect(patch.sources!.map((s) => s.url)).toContain("https://a.test/1");
    expect(patch.scout).toBeDefined();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/nodes/scout.node.test.ts`
Expected: FAIL, `scoutNode` not found.

- [ ] **Step 4: Implement the scout node**

Create `packages/engine/src/nodes/scout.node.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { runScout } from "../agents/scout.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue } from "../state.js";

/** Build the flat source list (url, body) the fact gate needs, from scout output. */
function flattenSources(scout: Awaited<ReturnType<typeof runScout>>): { url: string; body: string }[] {
  const out = new Map<string, string>();
  for (const t of [...scout.trending_topics, ...scout.recent_launches]) {
    if (t.url && !out.has(t.url)) out.set(t.url, t.summary ?? "");
  }
  return [...out.entries()].map(([url, body]) => ({ url, body }));
}

export async function scoutNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.scout.model);
  const { value: scout, costUsd } = await traced("scout", model, { window_days: 7 }, async () => {
    const r = await runScout({ client, brand: state.profile.brand });
    return { value: r, costUsd: r.cost_usd, output: { source: r.source } };
  });
  return { scout, sources: flattenSources(scout), costUsd };
}
```
Note: `runScout`'s exact param object and return field names come from v1 `agents/scout.js`; read it and match (it takes `{ client, brand, today? }` and returns `{ source, trending_topics, recent_launches, cost_usd }`). Adapt field access if the real shape differs.

- [ ] **Step 5: Run the scout node test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/nodes/scout.node.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the strategist node (no new test file; covered by graph integration test in B7)**

Create `packages/engine/src/nodes/strategist.node.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { runStrategist } from "../agents/strategist.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue } from "../state.js";

export async function strategistNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.strategist.model);
  const { value, costUsd } = await traced("strategist", model, { angleCount: 3 }, async () => {
    const r = await runStrategist({
      client,
      brand: state.profile.brand,
      scout: state.scout!,
      clusters: [],
      recentAngles: [],
    });
    return { value: r.angles, costUsd: r.cost_usd, output: { angles: r.angles.length } };
  });
  if (value.length !== 3) {
    return { aborted: true, abortReason: `strategist_incomplete: got ${value.length} angles`, costUsd };
  }
  return { angles: value, costUsd };
}
```
Note: match `runStrategist`'s real params/return from v1 `agents/strategist.js` (it takes `{ client, brand, scout, clusters, recentAngles }` and returns `{ angles, cost_usd }`).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/nodes/_node.ts packages/engine/src/nodes/scout.node.ts packages/engine/src/nodes/strategist.node.ts packages/engine/tests/nodes/scout.node.test.ts
git commit -m "feat(nodes): traced node helper + scout and strategist nodes"
```

## Task B5: Draft + critic nodes (3-day fan-out, retry as state)

These reuse v1's `runDrafter` and `runCritic` (which already fan out three days via `Promise.all`). The critic node also runs the surgical retry for `fix-block` days, capped by `brand.agents.max_retry_loops`. The retry is expressed as a conditional edge in the graph (Task B7); this node just produces drafts/verdicts and increments `retries`.

**Files:**
- Create: `packages/engine/src/nodes/draft.node.ts`, `packages/engine/src/nodes/critic.node.ts`
- Test: `packages/engine/tests/nodes/critic.node.test.ts`

- [ ] **Step 1: Implement the draft node**

Create `packages/engine/src/nodes/draft.node.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { runDrafter, type DrafterSource } from "../agents/drafter.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue, Day } from "../state.js";

/** Map each angle's source URLs back to bodies from state.sources. */
function sourcesByDay(state: GraphStateValue): Record<Day, DrafterSource[]> {
  const bodyByUrl = new Map(state.sources.map((s) => [s.url, s.body]));
  const out: Record<Day, DrafterSource[]> = { mon: [], wed: [], fri: [] };
  for (const a of state.angles) {
    out[a.day as Day] = a.sources.map((url: string) => ({ url, body: bodyByUrl.get(url) ?? "" }));
  }
  return out;
}

export async function draftNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.drafter.model);
  const empty: Record<Day, string[]> = { mon: [], wed: [], fri: [] };
  const { value, costUsd } = await traced("draft", model, { days: 3 }, async () => {
    const r = await runDrafter({
      client,
      brand: state.profile.brand,
      angles: state.angles,
      sourcesByDay: sourcesByDay(state),
      voiceSamplesByDay: empty,
    });
    return { value: r.results, costUsd: r.cost_usd, output: { drafted: r.results.length } };
  });
  const drafts = { mon: undefined, wed: undefined, fri: undefined } as Record<Day, any>;
  for (const res of value) drafts[res.day as Day] = res.draft;
  return { drafts, costUsd };
}
```

- [ ] **Step 2: Write the failing test for the critic node (mocked)**

Create `packages/engine/tests/nodes/critic.node.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => ({
    verdicts: [
      { day: "mon", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
      { day: "wed", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
      { day: "fri", verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] },
    ],
    cost_usd: 0.02,
  })),
}));

import { criticNode } from "../../src/nodes/critic.node.js";

const baseState = {
  profile: { brand: { agents: { critic: { model: "claude-sonnet-4-6" } } } },
  drafts: {
    mon: { post_text: "x", pillar: "shipped", claims: [] },
    wed: { post_text: "y", pillar: "framework", claims: [] },
    fri: { post_text: "z", pillar: "critique", claims: [] },
  },
  verdicts: { mon: undefined, wed: undefined, fri: undefined },
} as any;

describe("criticNode", () => {
  it("records three verdicts and the critic cost", async () => {
    const patch = await criticNode(baseState);
    expect(Object.values(patch.verdicts!).every((v) => v!.verdict === "approve")).toBe(true);
    expect(patch.costUsd).toBeCloseTo(0.02);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/nodes/critic.node.test.ts`
Expected: FAIL, `criticNode` not found.

- [ ] **Step 4: Implement the critic node**

Create `packages/engine/src/nodes/critic.node.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { runCritic } from "../agents/critic.js";
import { resolveModelId } from "../lib/llm.js";
import { traced } from "./_node.js";
import type { GraphStateValue, Day } from "../state.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

export async function criticNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const model = resolveModelId(state.profile.brand.agents.critic.model);
  const drafts = DAYS.filter((d) => state.drafts[d]).map((d) => ({
    day: d,
    draft: {
      post_text: (state.drafts[d] as { post_text: string }).post_text,
      pillar: (state.drafts[d] as { pillar: string }).pillar,
    },
  }));
  const { value, costUsd } = await traced("critic", model, { days: drafts.length }, async () => {
    const r = await runCritic({ client, brand: state.profile.brand, drafts });
    return { value: r.verdicts, costUsd: r.cost_usd, output: { verdicts: r.verdicts.length } };
  });
  const verdicts = { ...state.verdicts };
  for (const v of value) verdicts[v.day as Day] = v;
  return { verdicts, costUsd };
}
```
Note: the surgical retry of `fix-block` days reuses v1's `surgicalRetry` logic. For the 24h MVP, keep retries simple: the graph's conditional edge (B7) loops `critic -> draft` while any day is `fix-block` and `retryPass < max_retry_loops`. The draft node already re-drafts all days; that is acceptable for the MVP. A targeted surgical retry is a v2.1 refinement.

- [ ] **Step 5: Run the critic node test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/nodes/critic.node.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/nodes/draft.node.ts packages/engine/src/nodes/critic.node.ts packages/engine/tests/nodes/critic.node.test.ts
git commit -m "feat(nodes): draft and critic nodes with 3-day fan-out"
```

## Task B6: Gates (fact + voice) and the gate node

The fact gate is a thin wrapper over the existing, tested `runHallucinationGate`. The voice gate wraps `runVoiceGate` and honors `gates.voice_mode: log_only` (the first 48 hours). The gate node decides each day's publish/skip and appends a `DayOutcome`.

**Files:**
- Create: `packages/engine/src/gates/factGate.ts`, `packages/engine/src/gates/voiceGate.ts`, `packages/engine/src/nodes/gate.node.ts`
- Test: `packages/engine/tests/gates/factGate.test.ts`

- [ ] **Step 1: Write the failing test for the fact gate**

Create `packages/engine/tests/gates/factGate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runFactGate } from "../../src/gates/factGate.js";

const sources = [{ url: "https://real.test/a", body: "OpenAI shipped 40% faster inference." }];

describe("runFactGate", () => {
  it("passes a stat claim whose digits and URL are in the scouted sources", () => {
    const r = runFactGate({
      claims: [{ claim_text: "40% faster inference", type: "stat", source_url: "https://real.test/a", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(true);
  });

  it("fails a claim whose source_url was never scouted", () => {
    const r = runFactGate({
      claims: [{ claim_text: "90% faster", type: "stat", source_url: "https://fabricated.test/x", confidence: 0.9 }],
      sources,
    });
    expect(r.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/gates/factGate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the fact gate (wraps runHallucinationGate)**

Create `packages/engine/src/gates/factGate.ts`:

```typescript
import { runHallucinationGate } from "../lib/gate.js";
import type { Claim, ClaimVerdict } from "../lib/schema.js";

export interface FactGateInput {
  claims: Claim[];
  sources: { url: string; body: string }[];
}
export interface FactGateResult {
  pass: boolean;
  verdicts: ClaimVerdict[];
}

/**
 * Deterministic fact gate. Every non-opinion claim must cite a source_url that
 * exists in the scouted sources, and its content must map to that source body.
 * This is the v1 hallucination gate, now wired into the graph (closes the v1
 * TODO). Voice-corpus URLs are not valid sources here.
 */
export function runFactGate(input: FactGateInput): FactGateResult {
  const { pass, verdicts } = runHallucinationGate({
    claims: input.claims,
    sources: input.sources,
    voiceCorpusUrls: [],
  });
  return { pass, verdicts };
}
```

- [ ] **Step 4: Run the fact gate test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/gates/factGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the voice gate wrapper**

Create `packages/engine/src/gates/voiceGate.ts`:

```typescript
import { runVoiceGate } from "../lib/gate.js";
import type { Brand } from "../lib/brand.js";

export interface VoiceGateOutcome {
  /** true when the gate is satisfied OR the gate is in log_only mode. */
  pass: boolean;
  /** the raw deterministic failures, recorded even in log_only mode. */
  failures: string[];
  /** true when failures existed but were not enforced (log_only). */
  loggedOnly: boolean;
}

/**
 * Wrap the v1 voice gate. In log_only mode (first 48h per DESIGN), failures are
 * recorded but never block publication. In blocking mode, failures skip the day.
 */
export function runVoiceGateWrapped(
  post: string,
  opts: { brand: Brand; pillar: string; mode: "blocking" | "log_only" },
): VoiceGateOutcome {
  const { pass, failures } = runVoiceGate(post, { brand: opts.brand, pillar: opts.pillar });
  if (opts.mode === "log_only" && !pass) {
    return { pass: true, failures, loggedOnly: true };
  }
  return { pass, failures, loggedOnly: false };
}
```
Note: `brand.yaml` must gain a `gates` block (`voice_mode`, `fact_mode`). Add `gates: { voice_mode: "log_only", fact_mode: "log_only" }` to both example brand.yaml files AND extend `BrandSchema` in `lib/brand.ts` with an optional `gates` object defaulting to blocking. Do this in Step 6 below.

- [ ] **Step 6: Extend the brand schema with the gates block**

In `packages/engine/src/lib/brand.ts`, add before the root `BrandSchema`:

```typescript
export const GatesSchema = z.object({
  voice_mode: z.enum(["blocking", "log_only"]).default("blocking"),
  fact_mode: z.enum(["blocking", "log_only"]).default("blocking"),
}).default({ voice_mode: "blocking", fact_mode: "blocking" });
```

Add `gates: GatesSchema,` to the `BrandSchema` object. Add `gates: { voice_mode: "log_only", fact_mode: "log_only" }` to `examples/sai-voice/brand.yaml` and `examples/_template/brand.yaml`. Run `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/brand.test.ts` and confirm it still passes (the default keeps old fixtures valid).

- [ ] **Step 7: Implement the gate node**

Create `packages/engine/src/nodes/gate.node.ts`:

```typescript
import { runFactGate } from "../gates/factGate.js";
import { runVoiceGateWrapped } from "../gates/voiceGate.js";
import { observe } from "../lib/trace.js";
import type { GraphStateValue, Day, DayOutcome } from "../state.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

/** Strip em/en dashes mechanically before the voice gate sees the text (v1 behavior). */
function sanitize(text: string): string {
  return text.replace(/\s+[—–]\s+/g, ". ").replace(/[—–]/g, ", ");
}

export async function gateNode(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  const brand = state.profile.brand;
  const outcomes: DayOutcome[] = [];

  for (const day of DAYS) {
    const draft = state.drafts[day] as { post_text?: string; pillar?: string; claims?: any[] } | undefined;
    const verdict = state.verdicts[day];
    const retries = state.retries[day] ?? 0;

    if (!draft || !verdict || (verdict.verdict === "fix" && verdict.severity === "block")) {
      outcomes.push({ day, status: "skipped", reasonClass: "critic_block", retries });
      continue;
    }

    const post = sanitize(draft.post_text ?? "");
    const pillar = draft.pillar ?? "";

    const fact = await observe(`factGate:${day}`, { model: "deterministic" }, async () => {
      const r = runFactGate({ claims: (draft.claims ?? []) as any, sources: state.sources });
      return { value: r, usage: { output: { pass: r.pass } } };
    });
    if (!fact.pass && brand.gates.fact_mode === "blocking") {
      outcomes.push({ day, status: "skipped", reasonClass: "fact_fail", reason: fact.verdicts.filter((v) => v.verdict !== "PASS").map((v) => v.reason).join("; "), pillar, retries });
      continue;
    }

    const voice = await observe(`voiceGate:${day}`, { model: "deterministic" }, async () => {
      const r = runVoiceGateWrapped(post, { brand, pillar, mode: brand.gates.voice_mode });
      return { value: r, usage: { output: { pass: r.pass, loggedOnly: r.loggedOnly } } };
    });
    if (!voice.pass) {
      outcomes.push({ day, status: "skipped", reasonClass: "voice_fail", reason: voice.failures.join("; "), pillar, retries });
      continue;
    }

    const wordCount = post.split(/\s+/).filter(Boolean).length;
    outcomes.push({ day, status: "published", pillar, retries, wordCount, charCount: post.length });
  }

  return { days: outcomes };
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/gates packages/engine/src/nodes/gate.node.ts packages/engine/src/lib/brand.ts packages/engine/tests/gates/factGate.test.ts examples
git commit -m "feat(gates): wire deterministic fact gate + log_only voice gate into a gate node"
```

## Task B7: The graph + run wrapper

Wire the nodes into a `StateGraph` with the conditional retry edge, then a `run()` that builds initial state, opens the trace, invokes the graph, and returns a summary.

**Files:**
- Create: `packages/engine/src/graph.ts`, `packages/engine/src/run.ts`
- Test: `packages/engine/tests/graph.test.ts`

- [ ] **Step 1: Implement the graph**

Create `packages/engine/src/graph.ts`:

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphAnnotation, type GraphStateValue, type Day } from "./state.js";
import { scoutNode } from "./nodes/scout.node.js";
import { strategistNode } from "./nodes/strategist.node.js";
import { draftNode } from "./nodes/draft.node.js";
import { criticNode } from "./nodes/critic.node.js";
import { gateNode } from "./nodes/gate.node.js";

const DAYS: Day[] = ["mon", "wed", "fri"];

/** After critic: retry the draft if any day is fix-block and we have budget. */
function routeAfterCritic(state: GraphStateValue): "draft" | "gate" {
  if (state.aborted) return "gate";
  const max = state.profile.brand.agents.max_retry_loops;
  const anyBlocked = DAYS.some((d) => {
    const v = state.verdicts[d];
    return v && v.verdict === "fix" && v.severity === "block";
  });
  if (anyBlocked && state.retryPass < max) return "draft";
  return "gate";
}

/** Bump the retry pass counter when looping back to draft. */
async function bumpRetry(state: GraphStateValue): Promise<Partial<GraphStateValue>> {
  return { retryPass: state.retryPass + 1 };
}

/** After strategist: abort short-circuits straight to gate (which writes skips). */
function routeAfterStrategist(state: GraphStateValue): "draft" | "gate" {
  return state.aborted ? "gate" : "draft";
}

export function buildGraph() {
  return new StateGraph(GraphAnnotation)
    .addNode("scout", scoutNode)
    .addNode("strategist", strategistNode)
    .addNode("draft", draftNode)
    .addNode("critic", criticNode)
    .addNode("bumpRetry", bumpRetry)
    .addNode("gate", gateNode)
    .addEdge(START, "scout")
    .addEdge("scout", "strategist")
    .addConditionalEdges("strategist", routeAfterStrategist, { draft: "draft", gate: "gate" })
    .addEdge("draft", "critic")
    .addConditionalEdges("critic", routeAfterCritic, { draft: "bumpRetry", gate: "gate" })
    .addEdge("bumpRetry", "draft")
    .addEdge("gate", END)
    .compile();
}
```
Note: the retry loops `critic -> bumpRetry -> draft -> critic`. `bumpRetry` increments `retryPass` so the guard terminates. `routeAfterCritic` returns the LABEL `"draft"` which the conditional map points at the `bumpRetry` node (LangGraph maps the returned key to a node name).

- [ ] **Step 2: Implement the run wrapper**

Create `packages/engine/src/run.ts`:

```typescript
import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
dayjs.extend(isoWeek);
import { buildGraph } from "./graph.js";
import { loadProfile } from "./lib/profile.js";
import { initTracing, withTrace, traceUrl, flushTracing } from "./lib/trace.js";
import { GraphAnnotation, type DayOutcome } from "./state.js";

export interface RunResult {
  runId: string;
  week: string;
  profile: string;
  costUsd: number;
  traceUrl?: string;
  days: DayOutcome[];
  aborted: boolean;
  abortReason?: string;
}

export function computeIsoWeek(d: Date): string {
  return `${dayjs(d).isoWeekYear()}-W${String(dayjs(d).isoWeek()).padStart(2, "0")}`;
}

export async function run(opts: { profileDir: string; today?: Date; dryRun?: boolean }): Promise<RunResult> {
  initTracing();
  const today = opts.today ?? new Date();
  const week = computeIsoWeek(today);
  const runId = randomUUID();
  const profile = loadProfile(opts.profileDir);
  const graph = buildGraph();

  const initial = {
    runId,
    week,
    dryRun: opts.dryRun ?? false,
    profile: {
      name: opts.profileDir,
      path: profile.profilePath,
      brand: profile.brand,
      voiceCorpusDir: profile.voiceCorpusDir,
    },
  };

  const final = await withTrace(
    { runId, name: "linkedin-engine-run", metadata: { week, profile: opts.profileDir } },
    async () => graph.invoke(initial, { recursionLimit: 50 }),
  );
  await flushTracing();

  const value = final as typeof GraphAnnotation.State;
  return {
    runId,
    week,
    profile: opts.profileDir,
    costUsd: value.costUsd,
    traceUrl: traceUrl(runId),
    days: value.days,
    aborted: value.aborted,
    abortReason: value.abortReason,
  };
}
```

- [ ] **Step 3: Write the failing graph integration test (all nodes mocked)**

Create `packages/engine/tests/graph.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/agents/scout.js", () => ({
  runScout: vi.fn(async () => ({
    source: "web_search",
    trending_topics: [{ url: "https://s.test/1", summary: "OpenAI shipped 40% faster inference" }],
    recent_launches: [],
    cost_usd: 0.001,
  })),
}));
vi.mock("../src/agents/strategist.js", () => ({
  runStrategist: vi.fn(async () => ({
    angles: [
      { day: "mon", pillar: "shipped", sources: ["https://s.test/1"] },
      { day: "wed", pillar: "framework", sources: ["https://s.test/1"] },
      { day: "fri", pillar: "critique", sources: ["https://s.test/1"] },
    ],
    cost_usd: 0.01,
  })),
}));
vi.mock("../src/agents/drafter.js", () => ({
  runDrafter: vi.fn(async () => ({
    results: (["mon", "wed", "fri"] as const).map((day) => ({
      day,
      draft: { post_text: "Shipped a thing\n\nIt went well and we learned a lot from the work", pillar: day === "mon" ? "shipped" : day === "wed" ? "framework" : "critique", claims: [], angle_rationale: "", attempt: 0, cost_usd: 0 },
    })),
    cost_usd: 0.03,
  })),
}));
vi.mock("../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => ({
    verdicts: (["mon", "wed", "fri"] as const).map((day) => ({ day, verdict: "approve", severity: "soft", reasons: [], specific_fixes: [] })),
    cost_usd: 0.02,
  })),
}));

import { run } from "../src/run.js";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("graph run (mocked agents)", () => {
  it("runs scout -> strategist -> draft -> critic -> gate and returns 3 day outcomes", async () => {
    const res = await run({ profileDir: path.join(REPO_ROOT, "examples/sai-voice"), dryRun: true });
    expect(res.days).toHaveLength(3);
    expect(res.costUsd).toBeCloseTo(0.001 + 0.01 + 0.03 + 0.02, 3);
    expect(res.aborted).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to confirm it fails, then passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/graph.test.ts`
Expected first: FAIL (modules not yet wired). After `graph.ts` and `run.ts` exist and any field-shape mismatches are fixed: PASS, three day outcomes, cost summed.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/graph.ts packages/engine/src/run.ts packages/engine/tests/graph.test.ts
git commit -m "feat(graph): StateGraph wiring with conditional retry edge + run wrapper"
```

## Task B8: CLI + draft file emission

The CLI parses `--profile` and `--dry-run`, runs the graph, writes `drafts/YYYY-WW/{day}.md` (or `.SKIPPED.md`), prints the trace URL and cost. File emission reuses v1's frontmatter + sanitize behavior.

**Files:**
- Create: `packages/engine/src/cli.ts`, `packages/engine/src/lib/emit.ts`
- Test: `packages/engine/tests/lib/emit.test.ts`

- [ ] **Step 1: Write the failing test for the file emitter**

Create `packages/engine/tests/lib/emit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emitDrafts } from "../../src/lib/emit.js";

describe("emitDrafts", () => {
  it("writes a published draft and a SKIPPED sidecar", () => {
    const root = mkdtempSync(path.join(tmpdir(), "drafts-"));
    emitDrafts({
      draftsRoot: root,
      week: "2026-W23",
      drafts: { mon: { post_text: "Hello world body text" } as any, wed: undefined, fri: undefined },
      days: [
        { day: "mon", status: "published", pillar: "shipped", retries: 0, wordCount: 3, charCount: 22 },
        { day: "wed", status: "skipped", reasonClass: "critic_block", reason: "weak hook", retries: 1 },
      ],
      traceUrl: "https://cloud.langfuse.com/trace/abc",
    });
    expect(existsSync(path.join(root, "2026-W23", "mon.md"))).toBe(true);
    expect(readFileSync(path.join(root, "2026-W23", "mon.md"), "utf8")).toContain("Hello world");
    expect(existsSync(path.join(root, "2026-W23", "wed.SKIPPED.md"))).toBe(true);
    expect(readFileSync(path.join(root, "2026-W23", "wed.SKIPPED.md"), "utf8")).toContain("weak hook");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/emit.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the emitter**

Create `packages/engine/src/lib/emit.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { DayOutcome, Day } from "../state.js";

export interface EmitParams {
  draftsRoot: string;
  week: string;
  drafts: Record<Day, { post_text?: string } | undefined>;
  days: DayOutcome[];
  traceUrl?: string;
}

export function emitDrafts(p: EmitParams): void {
  const dir = join(p.draftsRoot, p.week);
  mkdirSync(dir, { recursive: true });
  for (const outcome of p.days) {
    if (outcome.status === "published") {
      const post = p.drafts[outcome.day]?.post_text ?? "";
      const fm = stringifyYaml({
        week: p.week,
        day: outcome.day,
        pillar: outcome.pillar ?? "",
        retries: outcome.retries,
        word_count: outcome.wordCount ?? 0,
        char_count: outcome.charCount ?? 0,
        trace_url: p.traceUrl ?? "",
      });
      writeFileSync(join(dir, `${outcome.day}.md`), `---\n${fm}---\n\n${post}\n`);
    } else {
      const fm = stringifyYaml({
        week: p.week,
        day: outcome.day,
        status: "skipped",
        reason_class: outcome.reasonClass ?? "unknown",
        retries: outcome.retries,
        trace_url: p.traceUrl ?? "",
      });
      writeFileSync(
        join(dir, `${outcome.day}.SKIPPED.md`),
        `---\n${fm}---\n\n# ${outcome.day} SKIPPED (${outcome.reasonClass ?? "unknown"})\n\n${outcome.reason ?? ""}\n`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the emit test to confirm it passes**

Run: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/emit.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the CLI**

Create `packages/engine/src/cli.ts`:

```typescript
import { join } from "node:path";
import { run } from "./run.js";
import { emitDrafts } from "./lib/emit.js";
import { makeLogger } from "./lib/log.js";

const log = makeLogger({ name: "cli" });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const profileDir = arg("--profile");
  if (!profileDir) {
    console.error("usage: pipeline --profile <dir> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  const repoRoot = process.cwd();

  const result = await run({ profileDir, dryRun });
  emitDrafts({
    draftsRoot: join(repoRoot, "drafts"),
    week: result.week,
    drafts: { mon: undefined, wed: undefined, fri: undefined, ...collectDrafts(result) },
    days: result.days,
    traceUrl: result.traceUrl,
  });

  const published = result.days.filter((d) => d.status === "published").length;
  log.info(
    { week: result.week, published, skipped: result.days.length - published, cost_usd: result.costUsd, trace_url: result.traceUrl },
    "run complete",
  );
  console.log(`\nweek ${result.week}: ${published}/3 published, $${result.costUsd.toFixed(4)}`);
  if (result.traceUrl) console.log(`trace: ${result.traceUrl}`);
  process.exitCode = published > 0 ? 0 : 1;
}

// run() returns outcomes, not bodies; re-thread published bodies from the graph
// is unnecessary here because emit reads post_text from the outcome's draft.
// For the MVP, run() is extended to return drafts alongside days (see note).
function collectDrafts(result: { days: { day: string }[] }): Record<string, { post_text?: string } | undefined> {
  return {};
}

void main();
```
Note: for `emitDrafts` to write bodies, `run()` must also return the published drafts. Extend `RunResult` in `run.ts` with `drafts: Record<Day, { post_text?: string } | undefined>` set from `value.drafts`, and have `collectDrafts` return `result.drafts`. Make that one-line addition to `run.ts` and `cli.ts` together, then typecheck.

- [ ] **Step 6: Typecheck and run the full engine suite**

Run: `pnpm --filter @linkedin-engine/engine run typecheck`
Expected: exits 0.

Run: `pnpm --filter @linkedin-engine/engine test`
Expected: all tests pass (v1 carried tests + new node/gate/graph/profile/trace/emit tests).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/cli.ts packages/engine/src/lib/emit.ts packages/engine/src/run.ts packages/engine/tests/lib/emit.test.ts
git commit -m "feat(cli): --profile entry point + draft file emission with trace URL"
```

---

# PHASE C — Verify, document, ship (hours 18 to 24)

## Task C1: CI workflow + cron rename

**Files:**
- Create: `.github/workflows/ci.yml`
- Move + edit: `.github/workflows/pipeline.yml` -> `.github/workflows/cron.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main, v2-langgraph]
  pull_request:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r run typecheck
      - run: pnpm -r test
```

- [ ] **Step 2: Rename and update the cron workflow**

```bash
git mv .github/workflows/pipeline.yml .github/workflows/cron.yml
```

Edit `.github/workflows/cron.yml`:
- Change `name: pipeline` to `name: cron`.
- Change `with: { version: 9 }` to `with: { version: 10 }`.
- Replace the `run: pnpm pipeline` step's `run:` with `run: pnpm pipeline --profile examples/sai-voice`.
- Add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` to the step `env:` block, each reading from `secrets`.
- Remove the `VOYAGE_API_KEY` env line (v2 scout uses web_search/RSS, not Voyage embeddings).
- Leave the cron schedule, the cost-budget assertion, the commit step, and the failure-issue step unchanged.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/cron.yml
git commit -m "ci: add typecheck+test workflow, point cron at --profile examples/sai-voice"
```

## Task C2: Three dry runs on real keys (GATE 3 — owner pre-approved)

**Files:** none (produces `drafts/` output and Langfuse traces)

- [ ] **Step 1: Confirm keys are present locally**

Run: `test -f .env && grep -c ANTHROPIC_API_KEY .env`
Expected: prints `1`. If `.env` is missing, copy `.env.example` to `.env` and ask the owner to fill ANTHROPIC + LANGFUSE keys before continuing.

- [ ] **Step 2: First dry run**

Run: `pnpm pipeline --profile examples/sai-voice --dry-run`
Expected: prints `week 2026-Wxx: N/3 published, $0.xxxx` and a `trace:` URL. Three files appear under `drafts/2026-Wxx/`.

- [ ] **Step 3: Inspect the output**

Run: `ls drafts/$(date +%G)-W* && head -20 drafts/*/mon.md 2>/dev/null || head -20 drafts/*/mon.SKIPPED.md`
Expected: a published `mon.md` with frontmatter including `trace_url`, OR a `mon.SKIPPED.md` with a reason class. Either is a valid run.

- [ ] **Step 4: Open the trace and confirm spans**

Open the printed `trace:` URL. Confirm one trace with spans for `scout`, `strategist`, `draft`, `critic`, and `factGate:*` / `voiceGate:*`, each carrying model + token + cost metadata.

- [ ] **Step 5: Run twice more to confirm stability**

Run the same command two more times. Confirm three traces total, cost per run under the `budgets.cost_usd_per_run` cap, and no crash.

- [ ] **Step 6: Commit the demo drafts (these seed the README trace link)**

```bash
git add drafts/
git commit -m "chore: first v2 dry-run drafts (demo)"
```

## Task C3: README rewrite + .env.example + dependency cleanup

**Files:**
- Rewrite: `README.md`, `.env.example`
- Modify: remove `embed.ts`/`fetch.ts`/`rss.ts` only if now unused (verify first)

- [ ] **Step 1: Rewrite .env.example**

Create `.env.example`:

```
# Anthropic (required)
ANTHROPIC_API_KEY=sk-ant-...

# Langfuse Cloud (optional; without it, runs still write drafts, just no traces)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

- [ ] **Step 2: Rewrite README.md**

Create `README.md` (recruiter-readable, four-minute cold read):

````markdown
# linkedin-engine

An open-source agent that writes three LinkedIn drafts a week in your voice,
grounded in real sources, with every run fully traced. You give it a profile that
describes your voice. A graph of small agents does the rest. A human posts.

It writes drafts. It refuses to write bad ones. It shows its work.

## How it works

```
brand.yaml (your voice)  ->  scout -> strategist -> draft x3 -> critic x3
                                                                    |
                                                  approve | fix-block (retry <=2)
                                                                    v
                                              fact gate + voice gate (deterministic)
                                                                    |
                                                                    v
                                          drafts/YYYY-WW/{mon,wed,fri}.md
```

Every model call is a Langfuse span, so a whole run is one readable trace. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the full map.

- **Scout** (Haiku) finds sources from the last seven days.
- **Strategist** (Sonnet) picks one angle per day, pinned to that day's pillar.
- **Drafter** (Sonnet, x3 parallel) writes, each draft emitting its claims with source URLs.
- **Critic** (Sonnet, x3) reads each draft like a target reader.
- **Fact gate** (deterministic) rejects any claim whose source was not actually scouted.
- **Voice gate** (deterministic) rejects banned phrases, broken rhythm, dashes.

## Quick start (about 30 minutes)

```bash
pnpm install
cp .env.example .env          # add your Anthropic key (Langfuse optional)
pnpm pipeline --profile examples/sai-voice --dry-run
```

Make your own voice:

```bash
cp -r examples/_template examples/my-voice
# edit examples/my-voice/brand.yaml
pnpm pipeline --profile examples/my-voice
```

## What it costs

Under fifty cents a run, hard-capped in `brand.yaml`. The whole thing runs on
free tiers and a GitHub Actions cron. No server.

## Demo

- Demo profile: [`examples/sai-voice`](./examples/sai-voice)
- A recent run's drafts: [`drafts/`](./drafts)
- Public Langfuse trace: <!-- paste the trace URL from the first dry run here -->

## Design docs

- [Product requirements](./docs/v2/PRD.md)
- [Technical design](./docs/v2/DESIGN.md)
- [Architecture](./ARCHITECTURE.md)
- [How to contribute](./CONTRIBUTING.md)

## Status

v2 MVP. The engine, graph, tracing, and fact gate are live. The LLM judge,
Supabase stats, and the public dashboard land next. See [DESIGN.md](./docs/v2/DESIGN.md)
section 14 for the rollout.

MIT licensed. The engine never posts to LinkedIn. A human always posts.
````

After the first dry run (Task C2), paste the real trace URL into the "Public Langfuse trace" line.

- [ ] **Step 3: Remove now-unused v1 embedding deps if confirmed unused**

Run: `grep -rl "from .*embed" packages/engine/src || echo "embed unused"`
If `embed.ts` is referenced only by legacy/ or tests, leave it. If fully unused by non-legacy code, leave it for now (do not delete pre-existing code beyond scope). Only remove `@xenova/transformers` from deps if `embed.ts` is deleted, which is out of scope here.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: rewrite README for OSS launch, recruiter-readable"
```

## Task C4: Hour-24 definition-of-done verification

**Files:** none (verification only)

- [ ] **Step 1: Public visibility**

Run: `gh repo view Imasaikiran/linkedin-engine --json visibility -q .visibility`
Expected: `PUBLIC`.

- [ ] **Step 2: v1 tag present**

Run: `git tag --list v1.0.0`
Expected: `v1.0.0`.

- [ ] **Step 3: Typecheck across the workspace**

Run: `pnpm -r run typecheck`
Expected: exits 0.

- [ ] **Step 4: Full test suite**

Run: `pnpm -r test`
Expected: all pass.

- [ ] **Step 5: A real (non-dry) run produces three files each with a trace URL**

Run: `pnpm pipeline --profile examples/sai-voice`
Expected: three files under `drafts/<week>/`, each `.md` or `.SKIPPED.md` containing a `trace_url` line.

- [ ] **Step 6: Push the branch and open the cutover PR (GATE 4 — owner pre-approved)**

```bash
git push origin v2-langgraph
gh pr create --base main --head v2-langgraph \
  --title "v2: LangGraph engine, Langfuse tracing, wired fact gate, OSS structure" \
  --body "$(cat <<'EOF'
## What this ships (24h MVP, DESIGN section 14.1)

- Public repo, MIT license, v1 frozen at tag v1.0.0
- pnpm monorepo; engine in packages/engine; v1 reusable libs lifted unchanged
- LangGraph StateGraph: scout -> strategist -> draft -> critic -(retry)-> gate
- Langfuse trace per run, span per node, token + cost metadata
- Deterministic fact gate wired (closes the v1 TODO)
- Voice gate in log_only mode for the first 48h
- Voice carved out of the engine into examples/sai-voice; --profile CLI arg
- CLAUDE.md, AGENTS.md, ARCHITECTURE.md, CONTRIBUTING.md, issue/PR templates

## Deferred to hour 24-72 (separate plans)

LLM judge + golden corpus, Supabase stats, Vercel dashboard, first real cron,
voice gate flip to blocking, judge calibration.

## Verification

- pnpm -r run typecheck: green
- pnpm -r test: green
- 3 dry runs + 1 real run: drafts written, traces populated, cost under cap

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do NOT merge automatically. The owner reviews and merges, or keeps v1 on main and lets the branch run a few cron cycles first (DESIGN section 9 cutover criteria).

---

## Self-Review

**Spec coverage (DESIGN section 14.1):**
- Public repo flip: A2. MIT LICENSE: A1. CLAUDE.md/AGENTS.md/ARCHITECTURE.md/CONTRIBUTING.md/.github templates: A3-A5. Monorepo + v1 freeze (tag) + lift: A1, A6. Example profile carve-out + `--profile`: B1, B8. LangGraph supervisor + 5 nodes + parallel fan-out: B3-B7. Langfuse trace per run, span per node, token+cost: B2, B4-B7. Fact gate (claims vs sources, unit test of fabricated URL): B6. Voice gate port + log_only: B6. Three dry runs cost-capped: C2. README rewrite + demo trace link: C3. Hour-24 DoD (six checks): C4 maps to all six.
- DESIGN 14.5 check 5 (one span per node incl. factGate/voiceGate): satisfied by `observe()` calls in gate.node.ts and `traced()` in agent nodes.

**Placeholder scan:** No "TBD"/"implement later". Each code step shows real code. The two "Note:" callouts that say "match v1 shape" point at concrete v1 files with their exact param/return shapes (verified by reading them); they are adaptation instructions, not placeholders.

**Type consistency:** `GraphStateValue` channels (`runId, week, profile, scout, sources, angles, drafts, verdicts, retries, retryPass, costUsd, days, aborted, abortReason`) are referenced consistently across nodes, graph, run. `Day` = `"mon"|"wed"|"fri"` used everywhere. `traced()` returns `{ value, costUsd }`; nodes fold `costUsd` into the summing channel. `runFactGate` input `{ claims, sources }` matches its test. `DayOutcome` fields match between state.ts, gate.node.ts, and emit.ts.

**Known deviation (documented):** single trace per run with day-tagged spans, not three per-day traces (DESIGN 3.2). Stated at the top and in the PR body. Surgical per-day retry simplified to whole-batch re-draft (B5 note); v2.1 refinement.

**Scope:** Judge, Supabase, dashboard, real cron, blocking-mode flip all explicitly deferred. This plan is one coherent subsystem: the engine cutover + repo structure.
