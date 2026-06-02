# linkedin-engine v2: Product Requirements Document

**Status:** Draft for review
**Date:** 2026-06-03
**Author:** Sai Kiran
**Audience:** anyone considering using, contributing to, or forking this project

---

## What this is, in one paragraph

linkedin-engine is an open source agent that writes three LinkedIn drafts per week in your voice, with sources you can click, and a brand gate that rejects anything that sounds generic. You install it, give it a brand file that describes your voice, and a GitHub Actions cron job does the rest. Every run is fully visible. A public trace shows you exactly which model said what, what it cost, and why it passed or failed. You stay in control of the final post.

---

## The problem, in plain language

Most people who want to post on LinkedIn regularly hit one of three walls.

1. **They run out of time.** Writing a real post takes thirty to ninety minutes. After a busy week, nothing goes out.
2. **They use a tool that writes generic AI content.** It feels off. It sounds like everyone else. It hurts credibility instead of building it.
3. **They hire a ghostwriter.** It works, but it costs money, takes back and forth, and the voice still drifts.

The result is the same in all three cases. Posting stops. The audience forgets. The personal brand resets to zero.

The act of writing has been made faster by AI. The act of writing **in your own voice** has not. That gap is what this product fills.

---

## The goal

Make it possible for any working professional to publish three high quality, voice faithful LinkedIn posts per week, for less than the price of one coffee per month, with full transparency over how the writing happened.

Three success bars.

1. The owner reads the draft on a Sunday morning. They edit for five minutes. They post. They are not embarrassed.
2. A stranger reading the post cannot tell it came from an agent.
3. Anyone who is curious can click one link and see exactly what the agent did. Every model call. Every cost. Every reason for accept or reject.

If those three are true for one person, they will be true for many.

---

## The impact, and why this matters

For the individual user.

- Three posts a week, sustained for twelve weeks, is enough to start being known in a small niche on LinkedIn. Most people never get there.
- The voice gate prevents slow drift into generic AI writing. The brand stays consistent over months, not just one post.
- Less than two dollars a month in API cost. Cheaper than every alternative.

For the open source community.

- A working reference of a multi step agent system anyone can read, run, and modify. Most agent demos are toys. This one ships posts every week to a real account.
- A clean example of LangGraph plus Anthropic plus Langfuse working together. Many tutorials show two of these. Few show all three running in production.
- A teaching artifact. New builders can see what good looks like for a small agent product. Real config. Real traces. Real evaluation. No hand waving.

For the wider conversation about AI content.

- Most AI writing tools optimize for volume. This one optimizes for voice. That is a different opinion, and it is worth making the opinion visible.

---

## What we are trying to achieve

A public GitHub repository that does the following, end to end, with no missing pieces.

1. **Writes posts.** Three drafts every week, on a fixed schedule, grounded in real sources.
2. **Refuses to write bad posts.** A brand gate rejects content that uses banned words, breaks rhythm, or strays from voice. A fact gate rejects content with claims that have no source.
3. **Shows its work.** A public trace lets anyone see what the agent did, step by step.
4. **Improves over time.** Every run is scored against a small library of approved past posts. Bad runs cannot ship in silence.
5. **Stays cheap.** Each run costs less than fifty cents. Each post costs less than twenty cents.
6. **Stays out of the way.** It writes drafts. The human posts. No surprise activity on LinkedIn.

---

## How we are trying to achieve it, from first principles

The hardest problem in agent written content is not generating text. Models do that for free. The hard problem is **knowing when not to publish**.

Most AI writers fail because they generate, send, and hope. There is no second opinion. No taste filter. No source check. No rhythm check.

linkedin-engine solves this by treating writing as a pipeline of small, separated jobs. Each job has one responsibility.

| Job | What it does | Why it exists as a separate step |
|---|---|---|
| Scout | Finds sources from the last seven days | A draft with no sources is a draft with no truth |
| Strategist | Picks one angle per day, based on a fixed weekly rhythm | Without an angle, you get three posts about the same news |
| Drafter | Writes three drafts in parallel, one per day | Variety beats serial editing |
| Critic | Reads each draft like a target reader and demands fixes | A second pair of eyes catches what the writer misses |
| Fact gate | Checks every claim against a real source URL | Hallucinated stats kill trust faster than anything else |
| Voice gate | Rejects banned phrases, broken rhythm, generic openers | A consistent voice is a moat |
| Judge | Scores the draft against past approved posts | Quality cannot be allowed to regress in silence |

Each step is a small piece of code with one prompt and one schema. Any step can be replaced, tuned, or removed without breaking the rest.

Behind this sits a graph orchestrator (LangGraph) that handles the order, the retries, and the parallel runs. Around it sits a tracing layer (Langfuse) that records every model call so anyone can see what happened.

That is the entire architecture. There are no hidden parts.

---

## High level solution

```
brand.yaml  (your voice, your weekly rhythm, your rules)
    |
    v
Scout  ->  Strategist  ->  Drafter (x3)  ->  Critic (x3)
                                                |
                                                v
                                  Fact gate + Voice gate + Judge
                                                |
                                                v
                                drafts/YYYY-WW/{mon, wed, fri}.md
                                                |
                                                v
                                You read, edit five minutes, post.
```

A few quick facts.

- Written in TypeScript. Runs on Node 20 or higher.
- Uses Anthropic Haiku for cheap research and Anthropic Sonnet for writing and review.
- All node calls are traced in Langfuse. Public traces for the demo profile, private traces if you fork.
- A small Supabase database stores past sources (to avoid repeating them) and run statistics (for the dashboard).
- A small Next.js dashboard, deployed on Vercel, shows the last ten runs, cost, pass rate, and a link to each trace.
- Runs twice a week on GitHub Actions. No server to maintain. No daemon. Cron only.

The whole thing fits in one repo, runs on free tiers, and can be torn down by deleting the repo.

---

## How to set it up, for someone who wants this in their hands

This is the path from zero to your first three drafts.

### Prerequisites

You will need accounts on the following services. All have free tiers that are enough to run this.

1. **GitHub.** To host your fork and run the cron.
2. **Anthropic.** For the model API key.
3. **Langfuse Cloud.** For traces. Sign up at langfuse.com with your GitHub account.
4. **Supabase.** For the small database.
5. **Vercel** (optional). Only if you want the dashboard.

Plus Node 20 or higher installed locally.

### Step 1. Fork the repo

```
gh repo fork Imasaikiran/linkedin-engine --clone
cd linkedin-engine
pnpm install
```

### Step 2. Make your brand file

Copy the example profile and edit it.

```
cp -r examples/sai-voice examples/my-voice
```

Open `examples/my-voice/brand.yaml`. Change three things first. Leave the rest for later.

1. `identity.role`. What you do, in one line.
2. `voice.must_not_have.banned_phrases`. Words you never use.
3. `cadence.mon.pillar` and friends. What kind of post each day is (shipping story, framework, hot take, and so on).

That is it. The defaults are sane.

### Step 3. Add your API keys

Copy the example environment file.

```
cp .env.example .env
```

Open `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE=...
```

The Supabase schema lives in `packages/engine/migrations/`. Run:

```
pnpm db:push
```

This creates the two tables the engine needs (`runs` and `sources_seen`).

### Step 4. First run, locally

```
pnpm pipeline --profile examples/my-voice
```

It takes about ninety seconds. When it finishes, you will see:

- Three files in `drafts/YYYY-WW/`, one per day. Or one or more files named `*.SKIPPED.md` with the reason.
- A trace link in the console output that you can open in Langfuse.
- A row in your Supabase `runs` table.

If anything looks off, the trace tells you which node was wrong and what it said.

### Step 5. Wire the cron

Edit `.github/workflows/cron.yml`. The defaults run twice a week, Sunday and Wednesday at 00:30 UTC. Change the schedule if you want a different rhythm.

Add your API keys as GitHub repository secrets. The workflow reads from secrets, not from `.env`.

Push to your fork. The cron will fire on the next scheduled tick.

### Step 6. Optional: deploy the dashboard

```
cd packages/dashboard
vercel deploy
```

Add the same Supabase keys as Vercel environment variables. The dashboard reads from Supabase. No extra wiring needed.

That is the full setup. From zero to running cron is about thirty minutes.

---

## Out of scope, on purpose

The following are explicit non goals. Saying so up front prevents drift.

- No auto posting to LinkedIn. The engine never touches LinkedIn directly. The human posts.
- No image, carousel, or video generation. Text only.
- No multi tenant SaaS. This is a tool you self host. There is no managed plan.
- No support for other channels (Twitter, Substack, Threads) in v2. v3 maybe.
- No engagement based feedback loop in v2. Reading your own LinkedIn analytics and feeding it back to the engine is future work.

---

## What success looks like in 90 days

- The repo has been starred a few hundred times by people who actually run it.
- At least ten people have forked it and made their own brand profile.
- A working public demo trace is linked from the README and is loaded by curious visitors at least once a week.
- The author has published twelve weeks of consistent content in their own voice, using the engine.
- One or two contributors have submitted pull requests for small improvements (a new gate, a new judge variant, a new example profile).

If those five things happen, the project has done its job.

---

## What can go wrong, and what we do about it

| Risk | What we do |
|---|---|
| The voice gate is too strict, so almost everything gets rejected | The gate runs in log only mode for the first 48 hours. Then we tune thresholds based on real data. |
| The fact gate misses a fabricated claim | Manual audit of the first 30 published drafts. Tighten the prompt or add a deterministic URL check. |
| Langfuse goes down during a scheduled run | The engine writes drafts regardless. Traces are best effort, not blocking. |
| GitHub Actions cron drifts | We document UTC times clearly. Users can override the cron expression. |
| Costs creep up | Hard cap of fifty cents per run, configured in `brand.yaml`. The graph aborts if exceeded. |

---

## Why open source

Two reasons.

First, a voice faithful content agent should not be a black box. The whole point is that you trust the writing. Trust requires that you can read the code, read the prompts, and read the traces.

Second, the agent space needs more small, complete, real reference projects. Not toys. Not tutorials. Working systems. linkedin-engine is one of those, and it should be readable in an afternoon and runnable in thirty minutes.

If it helps one person ship twelve weeks of honest writing, it has paid back the time spent building it.

---

End of PRD. The technical design lives in [`docs/superpowers/specs/2026-06-03-linkedin-engine-v2-design.md`](docs/superpowers/specs/2026-06-03-linkedin-engine-v2-design.md).
