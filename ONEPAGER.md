# linkedin-engine — one-pager

> **An autonomous content engine that writes 3 source-grounded LinkedIn posts per week, designed to land an AI PM role at a frontier model company.**

---

## Why

Building public credibility for an AI PM role requires consistent, high-signal LinkedIn presence. Manual writing fails for three reasons:

| Failure mode | Cost |
|---|---|
| Skipping weeks when busy | Algorithm punishes inconsistency, audience forgets |
| AI-slop shortcuts | Burns credibility with the exact frontier-lab audience you want to reach |
| Hallucinated facts | One bad stat undoes months of trust |

The engine removes those failure modes by automating the boring parts (sourcing, drafting, gating) while keeping the human in the loop for taste (editing + posting).

---

## What

A TypeScript pipeline that runs every Sunday and Wednesday at 06:00 IST on GitHub Actions. Every run produces 3 draft posts (Mon / Wed / Fri) that are:

- **Grounded** — every named person, quoted phrase, numeric stat, and product capability is verified against a source URL
- **In voice** — deterministic gate enforces 7+ rules (no em-dashes, no AI clichés, hook length, paragraph density, "I" frequency)
- **On cadence** — pillar mix is fixed per day (Mon hot take, Wed framework/lesson/myth, Fri story/observation/list)
- **Cheap** — ~$0.04 per week ($2/year)

Output: `drafts/YYYY-WW/{mon,wed,fri}.md`. Human reads, edits, posts, marks done.

---

## The flow

```mermaid
flowchart TD
    A[Cron: Sun + Wed 00:30 UTC] --> B[1. Scrape]
    B -->|RSS / sitemaps / APIs| B1[~50-200 raw items]
    B1 --> C[2. Cluster]
    C -->|Voyage embeddings + cosine| C1[5-15 topic clusters]
    C1 --> D[3. Score]
    D -->|recency + source diversity + novelty| D1[ranked clusters]
    D1 --> E[4. Angle]
    E -->|LLM picks 3 angles<br/>matched to pillar cadence| E1[Mon / Wed / Fri angles]
    E1 --> F[5. Draft]
    F -->|claude-sonnet-4-6 + voice samples<br/>+ pillar template + sources| F1[3 JSON drafts]
    F1 --> G[6. Polish]
    G --> G1{Voice gate +<br/>Hallucination gate}
    G1 -->|pass| H[drafts/WW/day.md]
    G1 -->|fail| G2[Surgical retry x2]
    G2 --> G1
    G2 -.best attempt.-> H
    H --> I[Auto-commit to main]
    I --> J[Human reads, edits, posts]
    J --> K[pnpm posted mon --url ...]
    K --> L[posted/WW/day.md]

    style A fill:#dbeafe,stroke:#1e40af
    style H fill:#d1fae5,stroke:#065f46
    style J fill:#fef3c7,stroke:#92400e
    style L fill:#e0e7ff,stroke:#4338ca
```

---

## What problem each stage solves

| Stage | Problem | Mechanism |
|---|---|---|
| **Scrape** | Need fresh, trustworthy primary sources, not AI-generated noise | Curated allowlist in `config/sources.yaml` (frontier labs, top researchers' RSS) |
| **Cluster** | Same story breaks across 5 outlets — don't draft 5 versions of it | Voyage embeddings + cosine similarity grouping |
| **Score** | Most clusters aren't worth posting about | Composite: recency × source diversity × novelty vs. last 4 weeks |
| **Angle** | Posting "what happened" is commodity; posting "what it means" is differentiated | LLM picks 3 angles, one per day, constrained to that day's allowed pillars |
| **Draft** | Generic AI prose dies on LinkedIn | Voice samples from the user's own past posts + pillar template + grounded source bodies |
| **Polish** | Even "good" LLM output sneaks in clichés, em-dashes, fabricated stats | Deterministic regex gate + per-claim source verification; surgical retries; publishes the best of 3 attempts |

---

## How it's done — stack

```mermaid
flowchart LR
    subgraph Runtime
        TS[TypeScript Node 20<br/>ESM, strict]
        Z[Zod schemas<br/>between every stage]
    end
    subgraph Models
        A1[Claude Sonnet 4.6<br/>angle + draft + retry]
        V1[Voyage embeddings<br/>cluster + dedupe]
    end
    subgraph Infra
        GH[GitHub Actions cron]
        REPO[Private repo<br/>main = source of truth]
    end
    subgraph Quality
        VG[Voice gate<br/>regex, deterministic]
        HG[Hallucination gate<br/>per-claim type rules]
        T[48 unit tests<br/>vitest]
    end

    TS --> Z
    Z --> A1
    Z --> V1
    GH --> TS
    TS --> REPO
    A1 --> VG
    A1 --> HG
    T -.guards.-> TS
```

---

## Hard constraints (non-negotiable)

- ❌ NO hallucinated facts — every stat / quote / name / capability must trace to a source URL
- ❌ NO em-dashes, en-dashes, or LinkedIn AI clichés ("game-changer", "deep dive", "leverage", etc.)
- ❌ NO scraping internal artifacts (PRDs, Slack, sprint notes)
- ❌ NO auto-posting — human is the final filter
- ✅ Total spend ceiling: **<$1.50 / week** (currently $0.04)

---

## Status

Production. First end-to-end run: 2026-04-19. Cron armed. Drafts published to [`drafts/`](drafts/) on every run.

**Next milestone:** ship 12 weeks (Apr → Jul 2026) of consistent, high-quality posts. Use as portfolio for AI PM applications.
