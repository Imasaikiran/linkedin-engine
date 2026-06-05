import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeLogger } from "./log.js";
import type { DayOutcome } from "../state.js";

const log = makeLogger({ name: "db" });

// Hard ceiling on any single Supabase HTTP call. The DB layer is best-effort,
// so a hung request must not stall a run; after this the fetch aborts and
// supabase-js surfaces it as a normal error that the callers already log.
const DB_FETCH_TIMEOUT_MS = 10_000;

/** Wrap fetch so every Supabase request aborts after DB_FETCH_TIMEOUT_MS. */
function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DB_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

let cached: SupabaseClient | null | undefined;

/**
 * Supabase client, or null when SUPABASE_URL / SUPABASE_SERVICE_ROLE are absent.
 * Like the trace wrapper, the DB layer degrades to a no-op so a run still writes
 * its drafts without a database configured.
 */
function getClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  cached =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false },
          global: { fetch: timeoutFetch },
        })
      : null;
  return cached;
}

/** For tests: forget the cached client so env changes take effect. */
export function resetDbClient(): void {
  cached = undefined;
}

export interface RunRow {
  id: string;
  week: string;
  profile: string;
  published: number;
  skipped: number;
  cost_usd: number;
  trace_url?: string;
  aborted: boolean;
  days: DayOutcome[];
}

/** Upsert one run row. No-op (resolves) when no DB is configured. */
export async function upsertRun(row: RunRow): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from("runs").upsert(
    {
      id: row.id,
      week: row.week,
      profile: row.profile,
      published: row.published,
      skipped: row.skipped,
      cost_usd: row.cost_usd,
      trace_url: row.trace_url ?? null,
      aborted: row.aborted,
      days: row.days,
    },
    { onConflict: "id" },
  );
  if (error) log.warn({ err: error.message }, "db: upsertRun failed (non-blocking)");
}

export interface SourceRow {
  url: string;
  first_seen_week: string;
  title?: string;
  excerpt?: string;
}

/** Record scouted sources for cross-week dedup. No-op without a DB. Never throws. */
export async function recordSources(rows: SourceRow[]): Promise<void> {
  const client = getClient();
  if (!client || rows.length === 0) return;
  const { error } = await client.from("sources_seen").upsert(
    rows.map((r) => ({
      url: r.url,
      first_seen_week: r.first_seen_week,
      title: r.title ?? null,
      excerpt: r.excerpt ?? null,
    })),
    { onConflict: "url", ignoreDuplicates: true },
  );
  if (error) log.warn({ err: error.message }, "db: recordSources failed (non-blocking)");
}
