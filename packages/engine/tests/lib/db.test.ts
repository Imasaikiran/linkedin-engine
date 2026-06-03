import { describe, it, expect, beforeEach } from "vitest";
import { upsertRun, recordSources, resetDbClient } from "../../src/lib/db.js";

describe("db (no-op without keys)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    resetDbClient();
  });

  it("upsertRun resolves without throwing when no DB is configured", async () => {
    await expect(
      upsertRun({
        id: "r1",
        week: "2026-W23",
        profile: "examples/sai-voice",
        published: 2,
        skipped: 1,
        cost_usd: 0.21,
        aborted: false,
        days: [{ day: "mon", status: "published", retries: 0 }],
      }),
    ).resolves.toBeUndefined();
  });

  it("recordSources resolves without throwing when no DB is configured", async () => {
    await expect(
      recordSources([{ url: "https://a.test/1", first_seen_week: "2026-W23", title: "t" }]),
    ).resolves.toBeUndefined();
  });

  it("recordSources is a no-op for an empty list", async () => {
    await expect(recordSources([])).resolves.toBeUndefined();
  });
});
