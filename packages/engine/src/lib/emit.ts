import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { DayOutcome, Day } from "../state.js";

/**
 * Decide where a profile's drafts are written. Default (no `draftsDir`): the
 * shared repo `drafts/`, which the demo and the cron use. A relative `draftsDir`
 * resolves against the profile's own directory; an absolute one is used as-is.
 * This lets a personal profile keep its drafts in its own git-excluded folder
 * so they can never be committed to the public repo.
 */
export function resolveDraftsRoot(opts: {
  repoRoot: string;
  profileDir: string;
  draftsDir?: string;
}): string {
  if (!opts.draftsDir) return join(opts.repoRoot, "drafts");
  return isAbsolute(opts.draftsDir) ? opts.draftsDir : resolve(opts.profileDir, opts.draftsDir);
}

export interface EmitParams {
  draftsRoot: string;
  week: string;
  drafts: Record<Day, { post_text?: string } | undefined>;
  days: DayOutcome[];
  traceUrl?: string;
}

/**
 * Write each day's result to drafts/<week>/<day>.md (published) or
 * <day>.SKIPPED.md (skipped), with YAML frontmatter and the trace URL.
 */
export function emitDrafts(p: EmitParams): void {
  const dir = join(p.draftsRoot, p.week);
  mkdirSync(dir, { recursive: true });
  for (const outcome of p.days) {
    if (outcome.status === "published") {
      const post = p.drafts[outcome.day]?.post_text ?? "";
      const fm = stringifyYaml({
        week: p.week,
        day: outcome.day,
        pillar: outcome.pillar ?? "",
        retries: outcome.retries,
        word_count: outcome.wordCount ?? 0,
        char_count: outcome.charCount ?? 0,
        trace_url: p.traceUrl ?? "",
      });
      rmSync(join(dir, `${outcome.day}.SKIPPED.md`), { force: true });
      writeFileSync(join(dir, `${outcome.day}.md`), `---\n${fm}---\n\n${post}\n`);
    } else {
      const fm = stringifyYaml({
        week: p.week,
        day: outcome.day,
        status: "skipped",
        reason_class: outcome.reasonClass ?? "unknown",
        retries: outcome.retries,
        trace_url: p.traceUrl ?? "",
      });
      rmSync(join(dir, `${outcome.day}.md`), { force: true });
      writeFileSync(
        join(dir, `${outcome.day}.SKIPPED.md`),
        `---\n${fm}---\n\n# ${outcome.day} SKIPPED (${outcome.reasonClass ?? "unknown"})\n\n${outcome.reason ?? ""}\n`,
      );
    }
  }
}
