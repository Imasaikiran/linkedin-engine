import { ArrowRight } from "lucide-react";
import { GithubMark } from "./icons";
import { Button } from "../ui/button";

const GITHUB = "https://github.com/Imasaikiran/linkedin-engine";

export function Hero() {
  return (
    <section id="top" className="mx-auto max-w-5xl px-6 pt-20 pb-16 md:pt-28 md:pb-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
            Open source AI agent - runs on your own machine
          </p>
          <h1 className="mt-5 font-serif text-[2.6rem] leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Post on LinkedIn every week, in <span className="italic text-accent">your own words</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            An AI agent that reads what is new in your field each week, writes three posts in your
            style, and checks them so nothing fake or generic slips through. You read them on Sunday,
            edit for five minutes, and post.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="#try">
                <GithubMark className="h-4 w-4" />
                Get it on GitHub
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={`${GITHUB}/tree/main/drafts`}>
                Read posts it wrote
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <p className="mt-6 font-mono text-xs text-muted">
            MIT licensed - about $2 a month - it never posts for you
          </p>
        </div>

        <Terminal />
      </div>
    </section>
  );
}

function Terminal() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-band shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-band-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-band-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-band-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-band-line" />
        <span className="ml-2 font-mono text-xs text-band-muted">pnpm pipeline</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-band-ink">
        <code>
          <span className="text-band-muted">$ </span>pnpm pipeline --profile examples/sai-voice
          {"\n\n"}
          <span className="text-band-muted">scout</span>      9 sources, last 7 days{"\n"}
          <span className="text-band-muted">strategist</span> 3 angles, one per day{"\n"}
          <span className="text-band-muted">draft x3</span>   mon - wed - fri{"\n"}
          <span className="text-band-muted">critic x3</span>  2 approve, 1 retry{"\n"}
          <span className="text-band-muted">gates</span>      fact - voice - judge{"\n\n"}
          <span style={{ color: "#7fd99a" }}>week 2026-W23: 3/3 published, $0.18</span>
          {"\n"}
          <span className="text-band-muted">trace: cloud.langfuse.com/trace/...</span>
        </code>
      </pre>
    </div>
  );
}
