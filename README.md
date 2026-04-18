# linkedin-engine

3 LinkedIn drafts per week (Mon/Wed/Fri), source-grounded, human voice. Designed to support a 90-day plan to land an AI PM role at a frontier model company.

## What you read

Only this folder, ever:

```
drafts/YYYY-WW/{mon,wed,fri}.md
```

## How it runs

GitHub Actions cron triggers Sun 00:30 UTC and Wed 00:30 UTC. The pipeline runs 6 stages (scrape → cluster → score → angle → draft → polish), commits drafts to `main`, GitHub mobile sends a push.

## Local

```
pnpm install
cp .env.example .env   # fill ANTHROPIC_API_KEY + VOYAGE_API_KEY
pnpm test              # all unit tests
pnpm pipeline          # full week run
```

## Re-run a single stage

```
pnpm stage polish --week 2026-W17 --day fri
```

## After publishing on LinkedIn

```
pnpm posted fri --url https://www.linkedin.com/feed/update/urn:li:activity:...
```

Moves the draft to `posted/YYYY-WW/`, schedules add-to-self-corpus 30 days later.

## Spec

`docs/superpowers/specs/2026-04-19-linkedin-engine-design.md`
