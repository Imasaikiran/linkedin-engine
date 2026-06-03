import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { runVoiceGate } from "@linkedin-engine/engine/lib/gate.js";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

/**
 * Voice-gate calibration over the golden corpus.
 *
 * The golden posts are owner-approved (known-good). If the deterministic voice
 * gate rejects any of them, that is a FALSE POSITIVE: the gate would block the
 * author's own published work. We count those, report the rate, and tally the
 * failure reasons so we can decide whether the gate is safe to run blocking.
 */

interface ParsedPost {
  /** The actual post body the author published, with frontmatter, the leading
   *  section heading, and any trailing Sources/metadata block stripped. */
  body: string;
  /** Pillar from frontmatter, inferred from heading, or the default. */
  pillar: string;
}

/**
 * Extract the published post body and its pillar from a golden markdown file.
 *
 * Two shapes exist in the corpus:
 *   1. Files with a YAML frontmatter block (--- at top, closing --- a few lines
 *      down, with a `pillar:` field). Body is everything after the closing ---.
 *   2. Files with a `# Heading` first line and no frontmatter. Body starts after
 *      the heading. Both shapes may end with a `---` separator followed by a
 *      Sources / Why this angle / Metadata trailer that is NOT part of the post.
 *
 * We strip the trailer so the gate sees only the text the author would publish.
 */
function parsePost(raw: string, defaultPillar: string): ParsedPost {
  const lines = raw.split("\n");
  let pillar = defaultPillar;
  let start = 0;

  if (lines[0]?.trim() === "---") {
    // YAML frontmatter: find the closing --- and read pillar from inside.
    let close = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        close = i;
        break;
      }
    }
    if (close !== -1) {
      for (let i = 1; i < close; i++) {
        const m = lines[i]!.match(/^\s*pillar:\s*(.+?)\s*$/);
        if (m) pillar = m[1]!.replace(/^["']|["']$/g, "");
      }
      start = close + 1;
    }
  } else if (lines[0]?.startsWith("# ")) {
    // No frontmatter: a section heading like "# Monday — Hot take". Infer the
    // pillar from the heading label, then drop the heading line.
    const heading = lines[0]!.toLowerCase();
    if (heading.includes("framework")) pillar = "framework";
    else if (heading.includes("critique")) pillar = "critique";
    else if (heading.includes("hot take") || heading.includes("hottake")) pillar = "critique";
    else if (heading.includes("shipped")) pillar = "shipped";
    start = 1;
  }

  // Drop any trailing Sources/metadata block: the body ends at the first --- line
  // that appears after the post starts (the W16 files use this separator).
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }

  const body = lines.slice(start, end).join("\n").trim();
  return { body, pillar };
}

function main(): void {
  const profileDir = process.argv.includes("--profile")
    ? process.argv[process.argv.indexOf("--profile") + 1]!
    : "examples/sai-voice";
  const profile = loadProfile(resolve(REPO_ROOT, profileDir));
  const goldenDir = join(profile.profilePath, "golden");

  // Default pillar when a file gives us no signal: the Monday cadence pillar
  // from brand.yaml, or "shipped" if that is somehow absent.
  const defaultPillar = profile.brand.cadence?.mon?.pillar ?? "shipped";

  const files = readdirSync(goldenDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  if (files.length === 0) {
    console.log("no golden posts found");
    return;
  }

  const results: { file: string; pillar: string; pass: boolean; failures: string[] }[] = [];
  const failureTally = new Map<string, number>();

  for (const file of files) {
    const raw = readFileSync(join(goldenDir, file), "utf8");
    const { body, pillar } = parsePost(raw, defaultPillar);
    const { pass, failures } = runVoiceGate(body, { brand: profile.brand, pillar });
    results.push({ file, pillar, pass, failures });

    for (const f of failures) {
      // Normalize numeric details into a stable bucket so counts are meaningful.
      const key = bucketFailure(f);
      failureTally.set(key, (failureTally.get(key) ?? 0) + 1);
    }

    const status = pass ? "PASS" : "FAIL";
    const detail = failures.length ? `  [${failures.join(" | ")}]` : "";
    console.log(`  ${file} (pillar=${pillar}) -> ${status}${detail}`);
  }

  const total = results.length;
  const failed = results.filter((r) => !r.pass).length;
  const rate = (failed / total) * 100;

  const tally = [...failureTally.entries()].sort((a, b) => b[1] - a[1]);

  console.log("");
  console.log("Voice-gate calibration over the golden corpus");
  console.log(`  Total golden posts: ${total}`);
  console.log(`  False positives (known-good posts the gate FAILS): ${failed}`);
  console.log(`  False-positive rate: ${rate.toFixed(1)}%`);
  console.log("");
  console.log("  Most common failure reasons:");
  if (tally.length === 0) {
    console.log("    (none)");
  } else {
    for (const [reason, count] of tally) {
      console.log(`    ${count}x  ${reason}`);
    }
  }
}

/**
 * Collapse a specific failure string into a stable category so the tally groups
 * the same rule together even when the numbers differ across posts.
 */
function bucketFailure(failure: string): string {
  if (failure.startsWith("word count")) return "word count outside target_words band";
  if (failure.startsWith("char count")) return "char count outside target_chars band";
  if (failure.startsWith("first line word count")) return "first line over hook_max_words";
  if (failure.startsWith("paragraph has")) return "paragraph over paragraph_max_lines";
  if (failure.startsWith('"I" frequency')) return '"I" frequency over threshold';
  if (failure.startsWith("emoji count")) return "emoji count over limit";
  if (failure.startsWith("hashtag count")) return "hashtag count over limit";
  if (failure.startsWith("banned phrase")) return "banned phrase";
  if (failure.startsWith("banned opener")) return "banned opener";
  return failure;
}

main();
