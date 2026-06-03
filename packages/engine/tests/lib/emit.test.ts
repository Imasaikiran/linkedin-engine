import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emitDrafts } from "../../src/lib/emit.js";

describe("emitDrafts", () => {
  it("writes a published draft and a SKIPPED sidecar", () => {
    const root = mkdtempSync(path.join(tmpdir(), "drafts-"));
    emitDrafts({
      draftsRoot: root,
      week: "2026-W23",
      drafts: { mon: { post_text: "Hello world body text" }, wed: undefined, fri: undefined },
      days: [
        { day: "mon", status: "published", pillar: "shipped", retries: 0, wordCount: 3, charCount: 22 },
        { day: "wed", status: "skipped", reasonClass: "critic_block", reason: "weak hook", retries: 1 },
      ],
      traceUrl: "https://cloud.langfuse.com/trace/abc",
    });
    expect(existsSync(path.join(root, "2026-W23", "mon.md"))).toBe(true);
    expect(readFileSync(path.join(root, "2026-W23", "mon.md"), "utf8")).toContain("Hello world");
    expect(readFileSync(path.join(root, "2026-W23", "mon.md"), "utf8")).toContain("trace_url");
    expect(existsSync(path.join(root, "2026-W23", "wed.SKIPPED.md"))).toBe(true);
    expect(readFileSync(path.join(root, "2026-W23", "wed.SKIPPED.md"), "utf8")).toContain("weak hook");
  });
});
