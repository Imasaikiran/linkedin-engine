import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
dayjs.extend(isoWeek);
import { buildGraph } from "./graph.js";
import { loadProfile } from "./lib/profile.js";
import { initTracing, withTrace, traceUrl, flushTracing } from "./lib/trace.js";
import { upsertRun, recordSources } from "./lib/db.js";
import { GraphAnnotation, type DayOutcome, type Day } from "./state.js";
import type { Draft } from "./lib/schema.js";

export interface RunResult {
  runId: string;
  week: string;
  profile: string;
  costUsd: number;
  traceUrl?: string;
  days: DayOutcome[];
  drafts: Record<Day, { post_text?: string } | undefined>;
  aborted: boolean;
  abortReason?: string;
}

export function computeIsoWeek(d: Date): string {
  return `${dayjs(d).isoWeekYear()}-W${String(dayjs(d).isoWeek()).padStart(2, "0")}`;
}

export async function run(opts: {
  profileDir: string;
  today?: Date;
  dryRun?: boolean;
}): Promise<RunResult> {
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
    startedAt: Date.now(),
    profile: {
      name: opts.profileDir,
      path: profile.profilePath,
      brand: profile.brand,
      voiceCorpusDir: profile.voiceCorpusDir,
    },
  };

  const final = (await withTrace(
    { runId, name: "linkedin-engine-run", metadata: { week, profile: opts.profileDir } },
    async () => graph.invoke(initial, { recursionLimit: 50 }),
  )) as typeof GraphAnnotation.State;
  await flushTracing();

  const drafts: Record<Day, { post_text?: string } | undefined> = {
    mon: undefined,
    wed: undefined,
    fri: undefined,
  };
  for (const d of ["mon", "wed", "fri"] as Day[]) {
    const draft = final.drafts[d] as Draft | undefined;
    if (draft) drafts[d] = { post_text: draft.post_text };
  }

  // Persist run stats + scouted sources to Supabase. Both no-op without keys.
  const published = final.days.filter((d) => d.status === "published").length;
  const url = traceUrl(runId);
  await upsertRun({
    id: runId,
    week,
    profile: opts.profileDir,
    published,
    skipped: final.days.length - published,
    cost_usd: final.costUsd,
    trace_url: url,
    aborted: final.aborted,
    days: final.days,
  });
  if (final.scout) {
    await recordSources(
      [...final.scout.trending_topics, ...final.scout.recent_launches]
        .filter((t) => t.url)
        .map((t) => ({ url: t.url!, first_seen_week: week, title: t.title, excerpt: t.summary })),
    );
  }

  return {
    runId,
    week,
    profile: opts.profileDir,
    costUsd: final.costUsd,
    traceUrl: traceUrl(runId),
    days: final.days,
    drafts,
    aborted: final.aborted,
    abortReason: final.abortReason,
  };
}
