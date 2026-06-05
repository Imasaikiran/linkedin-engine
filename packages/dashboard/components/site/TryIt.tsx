import { KeyRound, Play } from "lucide-react";
import { GithubMark } from "./icons";
import { SectionHeader } from "./SectionHeader";
import { Button } from "../ui/button";

const GITHUB = "https://github.com/Imasaikiran/linkedin-engine";

const STEPS = [
  {
    n: "01",
    title: "Fork and install",
    body: "Fork the repo, then install. Node 20 and pnpm.",
    code: "gh repo fork Imasaikiran/linkedin-engine --clone\ncd linkedin-engine\npnpm install",
  },
  {
    n: "02",
    title: "Add your keys",
    body: "One Anthropic key is required. Langfuse and Supabase are optional and free.",
    code: "cp .env.example .env\n# ANTHROPIC_API_KEY=sk-ant-...",
  },
  {
    n: "03",
    title: "Make it your voice",
    body: "Copy the template profile and edit brand.yaml: your role, banned phrases, weekly cadence.",
    code: "cp -r examples/_template examples/my-voice\n# edit examples/my-voice/brand.yaml",
  },
  {
    n: "04",
    title: "Run it",
    body: "About ninety seconds. Three drafts land in drafts/, each with a trace link.",
    code: "pnpm pipeline --profile examples/my-voice",
  },
];

export function TryIt() {
  return (
    <section id="try" className="mx-auto max-w-5xl px-6 py-20 md:py-28">
      <SectionHeader
        eyebrow="Try it"
        title="Run it yourself in thirty minutes."
        lead="It is self-hosted, so you run it on your machine with your own key. Nothing to sign up for, no data leaves your control."
      />

      <div className="mt-12 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <ol className="space-y-7">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-4">
              <span className="font-mono text-sm text-accent">{s.n}</span>
              <div>
                <h3 className="text-base font-semibold text-ink">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="overflow-hidden rounded-xl border border-line bg-band">
          <div className="border-b border-band-line px-4 py-3 font-mono text-xs text-band-muted">
            terminal
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-relaxed text-band-ink">
            {STEPS.map((s) => `# ${s.title}\n${s.code}\n\n`).join("").trimEnd()}
          </pre>
        </div>
      </div>

      <div className="mt-12 flex flex-col items-start gap-4 rounded-xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.75} />
          <p className="text-sm leading-relaxed text-muted">
            You bring one Anthropic key. The engine never posts to LinkedIn and never touches your
            account. It writes drafts; you post.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button asChild>
            <a href={GITHUB}>
              <GithubMark className="h-4 w-4" />
              Fork on GitHub
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${GITHUB}/blob/main/CONTRIBUTING.md`}>
              <Play className="h-4 w-4" />
              Read the guide
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
