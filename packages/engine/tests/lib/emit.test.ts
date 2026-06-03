import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

  it("removes a stale SKIPPED sidecar when publishing the same day", () => {
    const root = mkdtempSync(path.join(tmpdir(), "drafts-"));
    const week = "2026-W23";
    mkdirSync(path.join(root, week), { recursive: true });
    writeFileSync(path.join(root, week, "mon.SKIPPED.md"), "stale skip\n");
    emitDrafts({
      draftsRoot: root,
      week,
      drafts: { mon: { post_text: "Fresh body text" }, wed: undefined, fri: undefined },
      days: [{ day: "mon", status: "published", pillar: "shipped", retries: 0, wordCount: 3, charCount: 15 }],
    });
    expect(existsSync(path.join(root, week, "mon.md"))).toBe(true);
    expect(existsSync(path.join(root, week, "mon.SKIPPED.md"))).toBe(false);
  });

  it("removes a stale published draft when skipping the same day", () => {
    const root = mkdtempSync(path.join(tmpdir(), "drafts-"));
    const week = "2026-W23";
    mkdirSync(path.join(root, week), { recursive: true });
    writeFileSync(path.join(root, week, "mon.md"), "stale post\n");
    emitDrafts({
      draftsRoot: root,
      week,
      drafts: { mon: undefined, wed: undefined, fri: undefined },
      days: [{ day: "mon", status: "skipped", reasonClass: "critic_block", reason: "weak hook", retries: 1 }],
    });
    expect(existsSync(path.join(root, week, "mon.SKIPPED.md"))).toBe(true);
    expect(existsSync(path.join(root, week, "mon.md"))).toBe(false);
  });
});
