import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
dayjs.extend(isoWeek);
import { buildGraph } from "./graph.js";
import { loadProfile } from "./lib/profile.js";
import { initTracing, withTrace, traceUrl, flushTracing } from "./lib/trace.js";
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
