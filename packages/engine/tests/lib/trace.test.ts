import { describe, it, expect, beforeEach } from "vitest";
import {
  initTracing,
  withTrace,
  observe,
  traceUrl,
  flushTracing,
  tracingEnabled,
} from "../../src/lib/trace.js";

describe("trace (no-op when keys absent)", () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it("is disabled without keys", () => {
    initTracing();
    expect(tracingEnabled()).toBe(false);
  });

  it("withTrace runs the body and returns its value with tracing disabled", async () => {
    initTracing();
    const out = await withTrace({ runId: "r1", name: "run", metadata: {} }, async () =>
      observe("scout", { model: "x" }, async () => ({ value: 42, usage: { costUsd: 0.01 } })),
    );
    expect(out).toBe(42);
  });

  it("traceUrl returns undefined when tracing is disabled", () => {
    initTracing();
    expect(traceUrl("r1")).toBeUndefined();
  });

  it("flushTracing resolves without throwing when disabled", async () => {
    await expect(flushTracing()).resolves.toBeUndefined();
  });
});
