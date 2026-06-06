import { Search, Compass, PenTool, Eye, ArrowDown } from "lucide-react";
import { SectionHeader } from "./SectionHeader";

const NODES = [
  { icon: Search, name: "Find", model: "Step 1", job: "Reads what is new in your field this week." },
  { icon: Compass, name: "Plan", model: "Step 2", job: "Picks one angle for each of the three posts." },
  { icon: PenTool, name: "Write", model: "Step 3", job: "Writes the three drafts, one for each day." },
  { icon: Eye, name: "Review", model: "Step 4", job: "Reads each draft the way your audience would." },
];

const GATES = [
  { name: "Fact check", detail: "Every number or claim has to trace to a real source it found. No made-up stats.", kind: "automatic" },
  { name: "Style check", detail: "Catches generic phrasing and anything that drifts from how you write.", kind: "automatic" },
  { name: "Quality score", detail: "Scores each draft against your best past posts. Low scores are held back.", kind: "AI" },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl px-6 py-20 md:py-28">
      <SectionHeader
        eyebrow="How it works"
        title="How it writes a post"
        lead="Writing the words is the easy part. The hard part is catching the bad ones before they go out. So every draft runs through three checks, and anything that fails is held back instead of posted."
      />

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {NODES.map((n, i) => (
          <div key={n.name} className="relative rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <n.icon className="h-5 w-5 text-ink" strokeWidth={1.75} />
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                {n.model}
              </span>
            </div>
            <h3 className="mt-4 font-mono text-sm font-medium text-ink">{n.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{n.job}</p>
            <span className="absolute -top-2.5 left-5 font-mono text-[11px] text-muted">
              0{i + 1}
            </span>
          </div>
        ))}
      </div>

      <div className="my-6 flex items-center justify-center text-muted" aria-hidden>
        <ArrowDown className="h-5 w-5" />
      </div>

      <div className="rounded-xl border border-line bg-band p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-xl text-band-ink">Three checks before a draft is kept</h3>
          <span className="font-mono text-xs text-band-muted">keep - or - hold back</span>
        </div>
        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-band-line bg-band-line sm:grid-cols-3">
          {GATES.map((g) => (
            <div key={g.name} className="bg-band p-5">
              <div className="flex items-center justify-between">
                <h4 className="font-mono text-sm font-medium text-band-ink">{g.name}</h4>
                <span className="rounded-full border border-band-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-band-muted">
                  {g.kind}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-band-muted">{g.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm leading-relaxed text-band-muted">
          If a draft fails a check, it is saved with the reason instead of posted, so you can see
          what went wrong. You still read each draft before it goes out, the same as you would any
          post.
        </p>
      </div>
    </section>
  );
}
