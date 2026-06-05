import { describe, it, expect } from "vitest";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { runVoiceGate } from "@linkedin-engine/engine/lib/gate.js";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";

// Resolve the repo root the same way packages/eval/src/calibrate.ts does:
// this file lives at packages/eval/tests, so the root is three levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Deterministic voice-gate regression test (no API key).
 *
 * The golden corpus under examples/sai-voice/golden/*.md is owner-approved,
 * known-good work. The deterministic voice gate must never reject any of it:
 * if it does, the gate would block the author's own published posts (a false
 * positive). This test locks in the voice calibration. If someone tightens a
 * rhythm band or adds a banned rule that rejects an approved post, CI fails.
 *
 * This is the BLOCKING eval gate. It runs under ci.yml's `pnpm -r test` and
 * needs no ANTHROPIC_API_KEY, so it gates merges deterministically. The LLM
 * judge in .github/workflows/eval.yml stays report-only.
 */

interface ParsedPost {
  body: string;
  pillar: string;
}

/**
 * Extract the published post body and its pillar from a golden markdown file.
 *
 * Mirrors the logic in packages/eval/src/calibrateVoice.ts so the test and the
 * calibration script agree on what counts as the post the author published.
 *
 * Two shapes exist in the corpus:
 *   1. Files with a YAML frontmatter block (--- at top, closing --- a few lines
 *      down, with a `pillar:` field). Body is everything after the closing ---.
 *   2. Files with a `# Heading` first line and no frontmatter. Body starts after
 *      the heading. Both shapes may end with a trailing `---` separator followed
 *      by a Sources/metadata trailer that is NOT part of the post.
 */
function parsePost(raw: string, defaultPillar: string): ParsedPost {
  const lines = raw.split("\n");
  let pillar = defaultPillar;
  let start = 0;

  if (lines[0]?.trim() === "---") {
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
    const heading = lines[0]!.toLowerCase();
    if (heading.includes("framework")) pillar = "framework";
    else if (heading.includes("critique")) pillar = "critique";
    else if (heading.includes("hot take") || heading.includes("hottake")) pillar = "critique";
    else if (heading.includes("shipped")) pillar = "shipped";
    start = 1;
  }

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

describe("voice gate does not regress against the golden corpus", () => {
  const profile = loadProfile(resolve(REPO_ROOT, "examples/sai-voice"));
  const goldenDir = join(profile.profilePath, "golden");

  // Default pillar when a file gives us no signal: the Monday cadence pillar
  // from brand.yaml, or "shipped" if that is somehow absent.
  const defaultPillar = profile.brand.cadence?.mon?.pillar ?? "shipped";

  const files = readdirSync(goldenDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  it("has a non-trivial golden corpus", () => {
    // Guard against the test silently passing on an empty or stripped dir.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("passes every known-good golden post (false-positive rate is 0)", () => {
    const failed: { file: string; pillar: string; failures: string[] }[] = [];

    for (const file of files) {
      const raw = readFileSync(join(goldenDir, file), "utf8");
      const { body, pillar } = parsePost(raw, defaultPillar);
      const { pass, failures } = runVoiceGate(body, { brand: profile.brand, pillar });
      if (!pass) failed.push({ file, pillar, failures });
    }

    const rate = (failed.length / files.length) * 100;
    // Surface the offending posts in the assertion message so a regression is
    // diagnosable from the CI log without rerunning anything.
    const detail = failed
      .map((r) => `  ${r.file} (pillar=${r.pillar}): ${r.failures.join(" | ")}`)
      .join("\n");
    expect(
      failed.length,
      `voice gate rejected ${failed.length} of ${files.length} approved golden posts ` +
        `(false-positive rate ${rate.toFixed(1)}%):\n${detail}`,
    ).toBe(0);
  });
});
