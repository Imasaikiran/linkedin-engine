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
- Every LLM call goes through `observe()` so it lands in a Langfuse span with
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
