-- linkedin-engine v2 schema. Paste into the Supabase SQL editor and run.
-- One row per pipeline run (the v2 graph runs all three days in one run).

create table if not exists runs (
  id uuid primary key,                      -- = runId, also the Langfuse trace id
  week text not null,                       -- e.g. 2026-W23
  profile text not null,                    -- e.g. examples/sai-voice
  published int not null default 0,
  skipped int not null default 0,
  cost_usd numeric(8,4) not null default 0,
  trace_url text,
  aborted boolean not null default false,
  days jsonb not null default '[]',         -- DayOutcome[]: day, status, reasonClass, pillar, wordCount
  created_at timestamptz not null default now()
);
create index if not exists runs_week_idx on runs (week);
create index if not exists runs_created_idx on runs (created_at desc);

-- Every source URL the scout has surfaced, for dedup across weeks.
create table if not exists sources_seen (
  url text primary key,
  first_seen_week text not null,
  title text,
  excerpt text,
  created_at timestamptz not null default now()
);

-- The dashboard reads with the anon key (read-only). Enable RLS and allow
-- public select; writes use the service role, which bypasses RLS.
alter table runs enable row level security;
alter table sources_seen enable row level security;

drop policy if exists "public read runs" on runs;
create policy "public read runs" on runs for select using (true);

drop policy if exists "public read sources" on sources_seen;
create policy "public read sources" on sources_seen for select using (true);
