# linkedin-engine

3 LinkedIn drafts per week (Mon/Wed/Fri), source-grounded, human voice. Designed to support a 90-day plan to land an AI PM role at a frontier model company.

## What you read

Only this folder, ever:

```
drafts/YYYY-WW/{mon,wed,fri}.md
```

Skipped days write `{day}.SKIPPED.md` with the reason (critic block, voice gate fail, abort). Never published automatically.

## How it runs

GitHub Actions cron triggers Sun 00:30 UTC and Wed 00:30 UTC. A single agentic pipeline runs five stages in sequence per day:

1. **Scout** (Haiku + web_search) — gather recent AI-lab + PM-community signals
2. **Strategist** (Sonnet) — pick one angle per day, pinned to `brand.cadence[day].pillar`
3. **Drafter ×3** (Sonnet, parallel) — one post per day
4. **Critic ×3** (Sonnet, parallel) — approve / fix-soft / fix-block with targeted feedback
5. **Deterministic voice gate** — brand.yaml-driven checks (banned phrases, rhythm, dashes) as a final safety net

Runs commit drafts + run summary to `main`. GitHub mobile sends a push.

## Single source of truth

`brand.yaml` owns everything tunable: voice rules, banned phrases, rhythm bands, per-day pillars, agent models, budgets. Change the band once, the gate and drafter prompts pick it up on the next run. No code edit, no redeploy.

## Local

```
pnpm install
cp .env.example .env   # fill ANTHROPIC_API_KEY
pnpm test              # all unit tests
pnpm pipeline          # full week run
```

## Spec

`docs/superpowers/specs/2026-04-19-linkedin-engine-design.md`
