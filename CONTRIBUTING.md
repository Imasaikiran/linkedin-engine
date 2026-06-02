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
