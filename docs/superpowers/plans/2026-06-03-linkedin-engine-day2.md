# linkedin-engine Day-2 Implementation Plan (judge, Supabase, dashboard)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the three deferred subsystems from DESIGN.md section 14.2: an LLM judge with a golden corpus (quality gate), a Supabase store for run stats, and a public Next.js dashboard. Order: judge first (highest value, calibrates on existing drafts), then Supabase (backs the dashboard), then dashboard.

**Builds on:** the merged v2 engine at `packages/engine`. Reuses `lib/llm.ts` (`complete`), `lib/trace.ts` (`observe`), `lib/profile.ts`, the graph and gate node.

**Tech:** TypeScript, Sonnet 4.6 for the judge, Supabase JS client, Next.js 15 (app router) on Vercel.

---

## Subsystem 1: LLM judge + golden corpus

### Design

- New package `packages/eval` with a golden corpus of owner-approved posts and a judge that scores a draft 1 to 5 against them.
- The judge is one Sonnet call: given the corpus (as voice exemplars) and a draft, return `{ score: 1-5, reason: string }`.
- Wire into the gate node AFTER the voice gate, as the final quality bar. Gated by `brand.judge.threshold`. Runs in `log_only` first (record score, never block), flips to `blocking` after calibration.
- Golden corpus seeds from the 12 existing published drafts (`drafts/20*/{day}.md`, excluding SKIPPED). Owner curates and expands to ~30, marking the best.

### Task J1: brand.yaml judge config + schema

**Files:** `packages/engine/src/lib/brand.ts`, `examples/sai-voice/brand.yaml`, `examples/_template/brand.yaml`, `packages/engine/tests/lib/brand.test.ts`

- [ ] Add to `brand.ts` before `BrandSchema`:

```typescript
export const JudgeSchema = z
  .object({
    threshold: z.number().min(1).max(5).default(3.5),
    golden_dir: z.string().default("golden"),
    mode: z.enum(["blocking", "log_only"]).default("log_only"),
  })
  .default({ threshold: 3.5, golden_dir: "golden", mode: "log_only" });
```
Add `judge: JudgeSchema,` to `BrandSchema`.

- [ ] Add to both example `brand.yaml` files:

```yaml
judge:
  threshold: 3.5
  golden_dir: golden
  mode: log_only
```

- [ ] Verify: `pnpm --filter @linkedin-engine/engine exec vitest run tests/lib/brand.test.ts` stays green (default keeps old fixtures valid).
- [ ] Commit: `feat(brand): add judge config block`

### Task J2: golden corpus seed

**Files:** `examples/sai-voice/golden/*.md` (seeded), `examples/sai-voice/golden/README.md`

- [ ] Copy the 12 existing published drafts into the corpus:

```bash
mkdir -p examples/sai-voice/golden
for f in $(find drafts -name "*.md" ! -name "*SKIPPED*"); do
  cp "$f" "examples/sai-voice/golden/$(echo "$f" | sed 's#drafts/##; s#/#-#g')"
done
```

- [ ] Write `examples/sai-voice/golden/README.md`:

```markdown
# Golden corpus

Owner-approved posts the judge scores new drafts against. Seeded from the engine's
own published drafts. Curate: delete weak ones, add your best historical LinkedIn
posts, aim for ~30. The judge reads these as the bar for voice and quality.
```

- [ ] Commit: `feat(eval): seed golden corpus from published drafts`

### Task J3: the judge

**Files:** `packages/eval/package.json`, `packages/eval/tsconfig.json`, `packages/eval/src/judge.ts`, `packages/eval/tests/judge.test.ts`

- [ ] Create `packages/eval/package.json` (name `@linkedin-engine/eval`, type module, deps: `@anthropic-ai/sdk`, `@linkedin-engine/engine` via `workspace:*`, `zod`; dev: tsx, typescript, vitest).
- [ ] Create `packages/eval/tsconfig.json` extending `../../tsconfig.base.json`.
- [ ] Write the failing test `packages/eval/tests/judge.test.ts`: mock `complete` to return `{"score":4,"reason":"on voice"}`, assert `runJudge` returns `{ score: 4, reason: "on voice" }`.
- [ ] Implement `packages/eval/src/judge.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { complete, resolveModelId } from "@linkedin-engine/engine/lib/llm.js";

const JudgeResultSchema = z.object({ score: z.number().min(1).max(5), reason: z.string() });
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

function loadCorpus(goldenDir: string, max = 8): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(goldenDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  } catch {
    return [];
  }
  return files.slice(0, max).map((f) => readFileSync(path.join(goldenDir, f), "utf8"));
}

export async function runJudge(p: {
  client: Anthropic;
  model: string;
  draftText: string;
  goldenDir: string;
}): Promise<{ result: JudgeResult; cost_usd: number }> {
  const corpus = loadCorpus(p.goldenDir);
  const system = [
    "You are a strict editor scoring a LinkedIn draft against a corpus of the",
    "author's best past posts. Score 1 to 5 on voice fidelity and quality:",
    "5 = indistinguishable from the author's best; 1 = generic AI slop.",
    "Return JSON only: { \"score\": <1-5>, \"reason\": \"<one sentence>\" }.",
  ].join("\n");
  const user = [
    "AUTHOR'S BEST POSTS (the bar):",
    ...corpus.map((c, i) => `--- exemplar ${i + 1} ---\n${c}`),
    "",
    "DRAFT TO SCORE:",
    p.draftText,
  ].join("\n");
  const res = await complete({ client: p.client, model: resolveModelId(p.model), system, user, maxTokens: 300, temperature: 0.2 });
  const parsed = JudgeResultSchema.parse(JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, "")));
  return { result: parsed, cost_usd: res.cost_usd };
}
```
Note: `@linkedin-engine/engine` must export `lib/llm.js`. Add an `exports` map to the engine `package.json` (`"./lib/*": "./src/lib/*"`) or import via relative path `../../engine/src/lib/llm.js`. Prefer the exports map.

- [ ] Verify the test passes. Commit: `feat(eval): LLM judge scoring against golden corpus`

### Task J4: wire judge into the gate node

**Files:** `packages/engine/src/nodes/gate.node.ts`, `packages/engine/tests/nodes/gate.node.test.ts`

- [ ] After the voice gate passes in `gate.node.ts`, call the judge inside an `observe("judge:<day>", ...)` span. Resolve `goldenDir` as `path.join(state.profile.path, brand.judge.golden_dir)`. If `score < brand.judge.threshold` and `brand.judge.mode === "blocking"`, push a skipped outcome with `reasonClass: "judge_low"`. Otherwise publish. Fold judge cost into `costUsd` (gate node must then return `costUsd`).
- [ ] Add a test: a draft with a mocked judge score below threshold in blocking mode is skipped; in log_only it publishes.
- [ ] Verify full suite green. Commit: `feat(graph): wire LLM judge into the gate as a threshold quality bar`

### Task J5: eval CI workflow

**Files:** `.github/workflows/eval.yml`

- [ ] On PR to main, run the judge against the last 3 published drafts and comment the scores. Use `ANTHROPIC_API_KEY` secret. Non-blocking (report only) for now.
- [ ] Commit: `ci: judge the last 3 drafts on PR`

---

## Subsystem 2: Supabase run stats

### Task S1: schema + client

**Files:** `packages/engine/migrations/001_init.sql`, `packages/engine/src/lib/db.ts`, `packages/engine/tests/lib/db.test.ts`

- [ ] Write `migrations/001_init.sql` with the `runs` and `sources_seen` tables from DESIGN.md section 5.3.
- [ ] Add `@supabase/supabase-js` to the engine. Write `lib/db.ts` exposing `upsertRun(summary)` and `recordSources(items)`, both no-ops when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE` are absent (mirrors the trace wrapper's degrade-to-noop pattern).
- [ ] Test: with no env, `upsertRun` resolves without throwing.
- [ ] Commit: `feat(db): Supabase client for run stats, no-op without keys`

### Task S2: write run stats from the CLI

**Files:** `packages/engine/src/run.ts` or `cli.ts`

- [ ] After a run, build a `RunRow` (week, day outcomes, cost, trace_url, gate results) and call `upsertRun`. One row per published or skipped day.
- [ ] Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE` to `.env.example` and the cron workflow secrets.
- [ ] Commit: `feat(run): persist run stats to Supabase`

---

## Subsystem 3: public dashboard

### Task D1: Next.js read-only dashboard

**Files:** `packages/dashboard/` (Next.js 15 app router)

- [ ] Scaffold `packages/dashboard` as a Next.js app. Single server-component page reading Supabase via service role.
- [ ] Render: last 10 runs (table: week, day, status, cost, trace link), a 12-week pass-rate and cost sparkline, the 3 latest published drafts (excerpts). Per DESIGN section 8.
- [ ] `revalidate = 60`. No auth. No interactive controls.
- [ ] Commit: `feat(dashboard): read-only run dashboard`

### Task D2: deploy to Vercel

- [ ] `vercel deploy` from `packages/dashboard`, set Supabase env vars in Vercel.
- [ ] Add the live URL to the README "Demo" section.
- [ ] Commit: `docs: link the live dashboard`

---

## Calibration (after first real cron + judge in log_only)

- [ ] Owner scores ~15 golden posts blind (1 to 5). Compare to the judge's scores. If the median delta is under 1 point, flip `brand.judge.mode` to `blocking`. Otherwise tune the judge prompt and re-test.
- [ ] Flip `gates.voice_mode` and `gates.fact_mode` to `blocking` once 48h of log_only data looks clean.

---

## Self-Review

- Spec coverage: DESIGN 14.2 lists judge+corpus, Supabase, dashboard, cron, voice-gate flip, calibration. J1-J5 cover judge+corpus+eval CI. S1-S2 cover Supabase. D1-D2 cover dashboard. Calibration section covers the flips.
- Judge degrades safely (log_only first). DB and dashboard degrade to no-op without keys, matching the trace wrapper pattern.
- Ordering: judge does not depend on Supabase; Supabase does not depend on the dashboard; dashboard depends on Supabase. Build in that order.
