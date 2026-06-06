import { Button } from "../ui/button";

const GITHUB = "https://github.com/Imasaikiran/linkedin-engine";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <a href="#top" className="font-mono text-sm font-medium tracking-tight text-ink">
          linkedin-engine
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="#how"
            className="hidden rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
          <a
            href="#configure"
            className="hidden rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:block"
          >
            Make it yours
          </a>
          <a
            href="#try"
            className="hidden rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:block"
          >
            Try it
          </a>
          <Button asChild size="sm">
            <a href={GITHUB}>GitHub</a>
          </Button>
        </div>
      </nav>
    </header>
  );
}
