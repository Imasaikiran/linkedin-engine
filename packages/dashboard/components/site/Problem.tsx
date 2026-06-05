import { Clock, Bot, PenLine } from "lucide-react";
import { SectionHeader } from "./SectionHeader";

const WALLS = [
  {
    icon: Clock,
    title: "You run out of time",
    body: "A real post takes thirty to ninety minutes. After a busy week, nothing goes out and the audience forgets.",
  },
  {
    icon: Bot,
    title: "Generic AI content",
    body: "Most tools write posts that sound like everyone else. It reads as off and quietly hurts your credibility.",
  },
  {
    icon: PenLine,
    title: "Ghostwriters drift",
    body: "Hiring works, but it costs money, takes back and forth, and the voice still drifts away from yours.",
  },
];

export function Problem() {
  return (
    <section className="border-t border-line bg-line-soft/40">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <SectionHeader
          eyebrow="The problem"
          title="Writing got faster. Writing in your voice did not."
          lead="Most people who want to post regularly hit one of three walls. The result is always the same: posting stops, and the personal brand resets to zero."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {WALLS.map((w) => (
            <div key={w.title} className="bg-surface p-6">
              <w.icon className="h-5 w-5 text-accent" strokeWidth={1.75} />
              <h3 className="mt-4 text-base font-semibold text-ink">{w.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{w.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
