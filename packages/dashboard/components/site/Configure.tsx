import { SectionHeader } from "./SectionHeader";

const BLOCKS = [
  {
    n: "1",
    label: "What it writes about",
    desc: "The searches it runs each week. Change these and it covers your topics, not someone else's.",
    file: "brand.yaml",
    code: `sources:
  web_search:
    queries:
      - "indie SaaS launches this week"
      - "pricing experiments, bootstrapped"
      - "solo founder revenue milestones"`,
  },
  {
    n: "2",
    label: "How you write",
    desc: "Words you never use, and how long your posts run. It is blocked from breaking these.",
    file: "brand.yaml",
    code: `voice:
  must_not_have:
    banned_phrases: ["leverage", "deep dive"]
  rhythm:
    target_words: [120, 340]   # short to long`,
  },
  {
    n: "3",
    label: "What to post each day",
    desc: "Three posts a week, each with its own shape. A shipping story, a how-to, or a hot take.",
    file: "brand.yaml",
    code: `cadence:
  mon: { pillar: shipped }     # a thing you shipped
  wed: { pillar: framework }   # a how-to or list
  fri: { pillar: critique }    # a take on the news`,
  },
  {
    n: "4",
    label: "Your best posts",
    desc: "Drop a few posts you are proud of into this folder. New drafts get scored against them.",
    file: "folder",
    code: `examples/my-voice/golden/
  my-best-post.md
  another-good-one.md`,
  },
];

export function Configure() {
  return (
    <section id="configure" className="mx-auto max-w-5xl px-6 py-20 md:py-28">
      <SectionHeader
        eyebrow="Make it yours"
        title="It is all one file."
        lead="Everything you change lives in one place. Copy the starter, edit these four things, and run it. No code."
      />

      <p className="mt-6 font-mono text-sm text-muted">
        <span className="text-ink">examples/my-voice/brand.yaml</span> - plus a folder for your best
        posts
      </p>

      <div className="mt-10 space-y-4">
        {BLOCKS.map((b) => (
          <div
            key={b.n}
            className="grid items-center gap-5 rounded-xl border border-line bg-surface p-5 md:grid-cols-[0.85fr_1.15fr] md:p-6"
          >
            <div className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line font-mono text-sm text-accent">
                {b.n}
              </span>
              <div>
                <h3 className="text-base font-semibold text-ink">{b.label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{b.desc}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-band-line bg-band">
              <div className="border-b border-band-line px-4 py-2 font-mono text-[11px] text-band-muted">
                {b.file === "folder" ? "your folder" : b.file}
              </div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-band-ink">
                {b.code}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
