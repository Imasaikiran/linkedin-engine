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
    title: "Make it sound like you",
    body: "Copy the starter profile and edit one file: what you do, words you never use, what to post each day.",
    code: "cp -r examples/_template examples/my-voice\n# edit examples/my-voice/brand.yaml",
  },
  {
    n: "04",
    title: "Run it",
    body: "About ninety seconds. Three drafts show up in the drafts folder, each with a link to how it was written.",
    code: "pnpm pipeline --profile examples/my-voice",
  },
];

export function TryIt() {
  return (
    <section id="try" className="mx-auto max-w-5xl px-6 py-20 md:py-28">
      <SectionHeader
        eyebrow="Try it"
        title="Run it yourself in about thirty minutes."
        lead="It runs on your own computer with your own key. Nothing to sign up for, and none of your data leaves your control."
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
            You bring one Anthropic key. It never logs into LinkedIn and never touches your account.
            It writes the drafts. You post them.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button asChild>
            <a href={GITHUB}>
              <GithubMark className="h-4 w-4" />
              Get it on GitHub
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${GITHUB}/blob/main/CONTRIBUTING.md`}>
              <Play className="h-4 w-4" />
              Read the setup guide
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
