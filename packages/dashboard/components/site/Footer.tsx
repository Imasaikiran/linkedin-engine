const GITHUB = "https://github.com/Imasaikiran/linkedin-engine";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-sm text-ink">linkedin-engine</p>
            <p className="mt-2 max-w-sm text-sm text-muted">
              The engine writes drafts. It refuses to write bad ones. A human always posts.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a href={GITHUB} className="text-muted hover:text-ink">
              GitHub
            </a>
            <a href={`${GITHUB}/blob/main/docs/v2/PRD.md`} className="text-muted hover:text-ink">
              PRD
            </a>
            <a href={`${GITHUB}/blob/main/docs/v2/DESIGN.md`} className="text-muted hover:text-ink">
              Design
            </a>
            <a href={`${GITHUB}/blob/main/CONTRIBUTING.md`} className="text-muted hover:text-ink">
              Contribute
            </a>
          </div>
        </div>
        <p className="mt-10 text-xs text-muted">
          MIT licensed. Built with LangGraph, Anthropic, Langfuse, Supabase, and Vercel.
        </p>
      </div>
    </footer>
  );
}
