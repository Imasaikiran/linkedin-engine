# linkedin-engine

3 LinkedIn post drafts per week, source-grounded, human voice. See `docs/superpowers/specs/2026-04-19-linkedin-engine-design.md` for design.

## Setup
```
pnpm install
cp .env.example .env   # fill in keys
pnpm test
pnpm pipeline
```

Drafts land in `drafts/YYYY-WW/{mon,wed,fri}.md`.
