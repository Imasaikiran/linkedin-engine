import { Annotation } from "@langchain/langgraph";
import type { Brand } from "./lib/brand.js";
import type { ScoutOutput } from "./agents/scout.js";
import type { StrategistAngle } from "./agents/strategist.js";
import type { CriticVerdict } from "./agents/critic.js";
import type { Draft } from "./lib/schema.js";

export type Day = "mon" | "wed" | "fri";

export interface ProfileRef {
  /** e.g. "examples/sai-voice" (as passed on the CLI). */
  name: string;
  path: string;
  brand: Brand;
  voiceCorpusDir: string;
}

export interface DayOutcome {
  day: Day;
  status: "published" | "skipped";
  reasonClass?: string;
  reason?: string;
  pillar?: string;
  retries: number;
  wordCount?: number;
  charCount?: number;
}

type DayMap<T> = Record<Day, T>;

/** Replace-on-write reducer (last write wins). Used for single-value channels. */
function lastWins<T>(_current: T, update: T): T {
  return update;
}

/** Merge a partial day map onto the current one. */
function mergeDays<T>(current: DayMap<T>, update: Partial<DayMap<T>>): DayMap<T> {
  return { ...current, ...update } as DayMap<T>;
}

export const GraphAnnotation = Annotation.Root({
  runId: Annotation<string>({ reducer: lastWins, default: () => "" }),
  week: Annotation<string>({ reducer: lastWins, default: () => "" }),
  dryRun: Annotation<boolean>({ reducer: lastWins, default: () => false }),
  profile: Annotation<ProfileRef>({ reducer: lastWins }),
  scout: Annotation<ScoutOutput | undefined>({ reducer: lastWins, default: () => undefined }),
  sources: Annotation<{ url: string; body: string }[]>({ reducer: lastWins, default: () => [] }),
  angles: Annotation<StrategistAngle[]>({ reducer: lastWins, default: () => [] }),
  drafts: Annotation<DayMap<Draft | undefined>>({
    reducer: mergeDays,
    default: () => ({ mon: undefined, wed: undefined, fri: undefined }),
  }),
  verdicts: Annotation<DayMap<CriticVerdict | undefined>>({
    reducer: mergeDays,
    default: () => ({ mon: undefined, wed: undefined, fri: undefined }),
  }),
  retries: Annotation<DayMap<number>>({
    reducer: mergeDays,
    default: () => ({ mon: 0, wed: 0, fri: 0 }),
  }),
  retryPass: Annotation<number>({ reducer: lastWins, default: () => 0 }),
  costUsd: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
  days: Annotation<DayOutcome[]>({ reducer: (c, u) => c.concat(u), default: () => [] }),
  aborted: Annotation<boolean>({ reducer: lastWins, default: () => false }),
  abortReason: Annotation<string | undefined>({ reducer: lastWins, default: () => undefined }),
});

export type GraphStateValue = typeof GraphAnnotation.State;
