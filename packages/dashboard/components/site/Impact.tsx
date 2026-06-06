import { SectionHeader } from "./SectionHeader";

const POINTS = [
  {
    stat: "3 a week",
    title: "You show up",
    body: "Three posts a week for twelve weeks is enough to get known in a small niche. Most people never keep it going that long.",
  },
  {
    stat: "Week 12",
    title: "Still sounds like you",
    body: "The style checks stop it drifting into generic AI writing. Week twelve still sounds like week one.",
  },
  {
    stat: "~$2 / mo",
    title: "Almost free",
    body: "Under fifty cents per run. It runs on free tiers and a scheduled job. No server, no subscription, no per-seat fee.",
  },
];

export function Impact() {
  return (
    <section className="border-t border-line bg-line-soft/40">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <SectionHeader
          eyebrow="What you get"
          title="Show up every week, in your own style, for a couple of dollars a month."
          lead="The idea is simple. Anyone with a job can put out three posts a week that sound like them, and see exactly how each one was written."
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
          Building with AI yourself? This is a small, complete example you can read in an afternoon
          and run in half an hour. Not a demo, not a tutorial. A real tool that puts out posts every
          week, with all the code in the open.
        </p>
      </div>
    </section>
  );
}
