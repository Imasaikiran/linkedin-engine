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

Skipped days write `{day}.SKIPPED.md` with the reason. Nothing posts automatically.

## Quick start (about 30 minutes)

```bash
pnpm install
cp .env.example .env          # add your Anthropic key (Langfuse optional)
pnpm pipeline --profile examples/sai-voice --dry-run
```

A run prints `week ...: N/3 published, $cost` and writes to `drafts/`.

Make your own voice:

```bash
cp -r examples/_template examples/my-voice
# edit examples/my-voice/brand.yaml
pnpm pipeline --profile examples/my-voice
```

## What it costs

Under fifty cents a run, capped in `brand.yaml`. The whole thing runs on free
tiers and a GitHub Actions cron. No server.

## Single source of truth

`brand.yaml` owns everything tunable: voice rules, banned phrases, rhythm bands,
per-day pillars, agent models, budgets, gate modes. To change strategy you edit
that file, not code.

## Demo

- Demo profile: [`examples/sai-voice`](./examples/sai-voice)
- A recent run's drafts: [`drafts/`](./drafts)
- Public Langfuse trace: [a real run, span per node](https://cloud.langfuse.com/trace/1e5a5622cf85438f2b45e7f50bf983de)

## Design docs

- [Product requirements](./docs/v2/PRD.md)
- [Technical design](./docs/v2/DESIGN.md)
- [Architecture](./ARCHITECTURE.md)
- [How to contribute](./CONTRIBUTING.md)

## Status

v2 is live. The LangGraph engine, Langfuse tracing, Supabase run stats, and the
read-only dashboard all ship. Three gates run in blocking mode: a deterministic
fact gate (every claim must cite a scouted source), a deterministic voice gate
(rhythm and banned-phrase rules), and an LLM judge scored against a golden corpus.
See [DESIGN.md](./docs/v2/DESIGN.md) section 14 and
[docs/v2/judge-calibration.md](./docs/v2/judge-calibration.md) for how the gates
were calibrated.

MIT licensed. The engine never posts to LinkedIn. A human always posts.
