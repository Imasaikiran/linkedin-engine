import { Clock, Bot, PenLine } from "lucide-react";
import { SectionHeader } from "./SectionHeader";

const WALLS = [
  {
    icon: Clock,
    title: "No time",
    body: "A good post takes thirty to ninety minutes to write. After a busy week you skip it, then you skip the next one.",
  },
  {
    icon: Bot,
    title: "Generic AI posts",
    body: "Most AI tools write posts that sound like everyone else. People notice, and it makes you look worse, not better.",
  },
  {
    icon: PenLine,
    title: "Ghostwriters drift",
    body: "Hiring someone works, but it costs money, takes back and forth, and slowly stops sounding like you.",
  },
];

export function Problem() {
  return (
    <section className="border-t border-line bg-line-soft/40">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <SectionHeader
          eyebrow="The problem"
          title="Why most people stop posting"
          lead="Almost everyone who tries to post regularly hits one of these three walls. Then the posts stop, and the audience forgets you."
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
