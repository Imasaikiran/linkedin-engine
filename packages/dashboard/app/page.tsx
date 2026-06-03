import { createClient } from "@supabase/supabase-js";

export const revalidate = 60;

const GITHUB = "https://github.com/Imasaikiran/linkedin-engine";

interface RunRow {
  id: string;
  week: string;
  profile: string;
  published: number;
  skipped: number;
  cost_usd: number;
  trace_url: string | null;
  aborted: boolean;
  created_at: string;
}

async function fetchRuns(): Promise<RunRow[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("runs")
    .select("id,week,profile,published,skipped,cost_usd,trace_url,aborted,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  return (data ?? []) as RunRow[];
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}
function fmtWhen(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export default async function Page() {
  const runs = await fetchRuns();

  return (
    <div className="wrap">
      <header>
        <h1>linkedin-engine</h1>
        <p>Run health for the open-source agent that writes three voice-faithful LinkedIn drafts a week.</p>
        <div className="links">
          <a href={GITHUB}>GitHub</a>
          <a href={`${GITHUB}/tree/main/drafts`}>Latest drafts</a>
          <a href="https://cloud.langfuse.com">Langfuse traces</a>
        </div>
      </header>

      {runs === null ? (
        <div className="empty">
          Dashboard is not connected to a database yet. Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_ANON_KEY</code> to show run stats.
        </div>
      ) : runs.length === 0 ? (
        <div className="empty">No runs recorded yet. The next scheduled run will appear here.</div>
      ) : (
        <Dashboard runs={runs} />
      )}

      <footer>
        Built with LangGraph, Anthropic, Langfuse, Supabase, and Vercel. The engine writes drafts; a
        human always posts. <a href={`${GITHUB}/blob/main/docs/v2/DESIGN.md`}>Design</a>.
      </footer>
    </div>
  );
}

function Dashboard({ runs }: { runs: RunRow[] }) {
  const totalPublished = runs.reduce((a, r) => a + r.published, 0);
  const totalSkipped = runs.reduce((a, r) => a + r.skipped, 0);
  const totalDrafts = totalPublished + totalSkipped;
  const passRate = totalDrafts ? Math.round((totalPublished / totalDrafts) * 100) : 0;
  const avgCost = runs.length ? runs.reduce((a, r) => a + Number(r.cost_usd), 0) / runs.length : 0;

  // Cost sparkline, oldest to newest (last 24 runs).
  const series = [...runs].reverse().slice(-24);
  const maxCost = Math.max(...series.map((r) => Number(r.cost_usd)), 0.0001);
  const last10 = runs.slice(0, 10);

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="label">Runs recorded</div>
          <div className="value">{runs.length}</div>
        </div>
        <div className="card">
          <div className="label">Publish rate</div>
          <div className="value">{passRate}%</div>
        </div>
        <div className="card">
          <div className="label">Avg cost / run</div>
          <div className="value">{fmtCost(avgCost)}</div>
        </div>
      </div>

      <h2>Cost per run</h2>
      <div className="spark" aria-label="cost per run">
        {series.map((r) => (
          <div
            key={r.id}
            className="bar"
            style={{ height: `${Math.max(2, (Number(r.cost_usd) / maxCost) * 100)}%` }}
            title={`${r.week}: ${fmtCost(Number(r.cost_usd))}`}
          />
        ))}
      </div>

      <h2>Last {last10.length} runs</h2>
      <table>
        <thead>
          <tr>
            <th>Week</th>
            <th>Published</th>
            <th>Skipped</th>
            <th>Cost</th>
            <th>When (UTC)</th>
            <th>Trace</th>
          </tr>
        </thead>
        <tbody>
          {last10.map((r) => (
            <tr key={r.id}>
              <td>{r.week}</td>
              <td>
                <span className="pill ok">{r.published}</span>
              </td>
              <td>{r.skipped > 0 ? <span className="pill skip">{r.skipped}</span> : <span className="muted">0</span>}</td>
              <td>{fmtCost(Number(r.cost_usd))}</td>
              <td className="muted">{fmtWhen(r.created_at)}</td>
              <td>{r.trace_url ? <a href={r.trace_url}>open</a> : <span className="muted">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
