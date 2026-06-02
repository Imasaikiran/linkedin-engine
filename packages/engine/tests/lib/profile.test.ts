import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadProfile } from "../../src/lib/profile.js";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

describe("loadProfile", () => {
  it("loads the sai-voice brand and resolves its voice corpus dir", () => {
    const dir = path.join(REPO_ROOT, "examples/sai-voice");
    const p = loadProfile(dir);
    expect(p.brand.identity.role.length).toBeGreaterThan(0);
    expect(p.profilePath).toBe(dir);
    expect(p.voiceCorpusDir).toBe(path.join(dir, "voice-corpus/external"));
  });

  it("loads the template profile too (engine is voice-agnostic)", () => {
    const dir = path.join(REPO_ROOT, "examples/_template");
    const p = loadProfile(dir);
    expect(p.brand.cadence.mon.pillar.length).toBeGreaterThan(0);
  });

  it("throws a clear error when the profile dir has no brand.yaml", () => {
    expect(() => loadProfile(path.join(REPO_ROOT, "examples/does-not-exist")))
      .toThrow(/brand\.yaml/);
  });
});
