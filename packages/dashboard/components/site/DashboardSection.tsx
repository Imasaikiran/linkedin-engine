import { createClient } from "@supabase/supabase-js";
import { ExternalLink } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { Badge } from "../ui/badge";

export const revalidate = 60;

interface RunRow {
  id: string;
  week: string;
  published: number;
  skipped: number;
  cost_usd: number;
  trace_url: string | null;
  created_at: string;
}

async function fetchRuns(): Promise<RunRow[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("runs")
    .select("id,week,published,skipped,cost_usd,trace_url,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  return (data ?? []) as RunRow[];
}

const cost = (n: number) => `$${Number(n).toFixed(4)}`;
const when = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export async function DashboardSection() {
  const runs = await fetchRuns();

  return (
    <section id="dashboard" className="border-t border-line">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <SectionHeader
          eyebrow="The dashboard"
          title="Every run, in the open."
          lead="No black box. This is the live run health: how many drafts published, what each run cost, and a link to the full trace. It updates as the cron fires."
        />

        {runs === null ? (
          <Empty>
            Not connected to a database yet. Set <code className="font-mono">SUPABASE_URL</code> and{" "}
            <code className="font-mono">SUPABASE_ANON_KEY</code> to show live run stats.
          </Empty>
        ) : runs.length === 0 ? (
          <Empty>No runs recorded yet. The next scheduled run will appear here.</Empty>
        ) : (
          <Stats runs={runs} />
        )}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-12 rounded-xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function Stats({ runs }: { runs: RunRow[] }) {
  const pub = runs.reduce((a, r) => a + r.published, 0);
  const skip = runs.reduce((a, r) => a + r.skipped, 0);
  const passRate = pub + skip ? Math.round((pub / (pub + skip)) * 100) : 0;
  const avg = runs.reduce((a, r) => a + Number(r.cost_usd), 0) / runs.length;
  const series = [...runs].reverse().slice(-24);
  const maxCost = Math.max(...series.map((r) => Number(r.cost_usd)), 0.0001);
  const last10 = runs.slice(0, 10);

  return (
    <div className="mt-12">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Runs recorded" value={String(runs.length)} />
        <Stat label="Publish rate" value={`${passRate}%`} />
        <Stat label="Avg cost / run" value={cost(avg)} />
      </div>

      <div className="mt-8">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">Cost per run</p>
        <div className="mt-3 flex h-14 items-end gap-1" aria-hidden>
          {series.map((r) => (
            <div
              key={r.id}
              className="flex-1 rounded-t-sm bg-accent/80"
              style={{ height: `${Math.max(4, (Number(r.cost_usd) / maxCost) * 100)}%` }}
              title={`${r.week}: ${cost(r.cost_usd)}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-10 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-line-soft/60 text-left">
              <Th>Week</Th>
              <Th>Published</Th>
              <Th>Skipped</Th>
              <Th>Cost</Th>
              <Th>When</Th>
              <Th>Trace</Th>
            </tr>
          </thead>
          <tbody>
            {last10.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <Td className="font-mono text-ink">{r.week}</Td>
                <Td>
                  <Badge className="border-ok/30 bg-ok/10 text-ok">{r.published}</Badge>
                </Td>
                <Td>
                  {r.skipped > 0 ? (
                    <Badge className="border-skip/30 bg-skip/10 text-skip">{r.skipped}</Badge>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                </Td>
                <Td>{cost(r.cost_usd)}</Td>
                <Td className="text-muted">{when(r.created_at)}</Td>
                <Td>
                  {r.trace_url ? (
                    <a
                      href={r.trace_url}
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-serif text-3xl tracking-tight text-ink">{value}</p>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
    {children}
  </th>
);
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-4 py-3 ${className}`}>{children}</td>
);
