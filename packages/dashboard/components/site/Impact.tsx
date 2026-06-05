import { SectionHeader } from "./SectionHeader";

const POINTS = [
  {
    stat: "3 / week",
    title: "Enough to be known",
    body: "Three posts a week for twelve weeks is enough to start being known in a small niche. Most people never get there.",
  },
  {
    stat: "0 drift",
    title: "The voice holds",
    body: "The gates reject slow drift into generic AI writing. Your voice stays consistent over months, not just one post.",
  },
  {
    stat: "< $2 / mo",
    title: "Cheaper than coffee",
    body: "Under fifty cents a run, hard-capped in config. Runs on free tiers and a cron job. No server to maintain.",
  },
];

export function Impact() {
  return (
    <section className="border-t border-line bg-line-soft/40">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <SectionHeader
          eyebrow="Goal and impact"
          title="Publish in your voice, sustainably, for the price of nothing."
          lead="The aim is simple: any working professional can publish three honest, voice-faithful posts a week, with full transparency over how the writing happened."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.title}>
              <p className="font-serif text-4xl tracking-tight text-ink">{p.stat}</p>
              <h3 className="mt-3 text-base font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-12 max-w-2xl border-l-2 border-accent pl-5 text-base leading-relaxed text-ink-soft">
          For the open-source community, this is a small, complete, real reference of a multi-step
          agent system. Not a toy, not a tutorial. A working system that ships posts every week,
          readable in an afternoon and runnable in thirty minutes.
        </p>
      </div>
    </section>
  );
}
