import { Search, Compass, PenTool, Eye, ArrowDown } from "lucide-react";
import { SectionHeader } from "./SectionHeader";

const NODES = [
  { icon: Search, name: "Scout", model: "Haiku", job: "Finds sources from the last seven days." },
  { icon: Compass, name: "Strategist", model: "Sonnet", job: "Picks one angle per day, pinned to its pillar." },
  { icon: PenTool, name: "Drafter x3", model: "Sonnet", job: "Writes three drafts, each citing its sources." },
  { icon: Eye, name: "Critic x3", model: "Sonnet", job: "Reads each draft like a target reader." },
];

const GATES = [
  { name: "Fact gate", detail: "Every claim must cite a scouted source.", kind: "deterministic" },
  { name: "Voice gate", detail: "Rhythm, banned phrases, no dashes.", kind: "deterministic" },
  { name: "Judge", detail: "Scored 1-5 against a golden corpus.", kind: "LLM" },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl px-6 py-20 md:py-28">
      <SectionHeader
        eyebrow="How it works"
        title="A graph of small agents, with gates that can say no."
        lead="The hard problem in agent-written content is not generating text. It is knowing when not to publish. Each step does one job, and three gates stand between a draft and your feed."
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
          <h3 className="font-serif text-xl text-band-ink">Three gates, all blocking</h3>
          <span className="font-mono text-xs text-band-muted">draft - or - SKIPPED</span>
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
          A draft that fails any gate is written as a SKIPPED file with the reason, never published.
          Factual accuracy stays with the critic and you. Every model call is one Langfuse span.
        </p>
      </div>
    </section>
  );
}
