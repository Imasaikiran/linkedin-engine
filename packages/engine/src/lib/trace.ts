import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  startActiveObservation,
  getActiveTraceId,
  setActiveTraceAsPublic,
} from "@langfuse/tracing";

let sdk: NodeSDK | undefined;
let enabled = false;
let host = "https://cloud.langfuse.com";

/** runId -> Langfuse trace id, captured at the root span so we can build a URL. */
const traceIdByRun = new Map<string, string>();

/**
 * Initialize Langfuse tracing if keys are present. Safe to call once at startup.
 * With no keys, tracing is a no-op and every wrapper below just runs its body.
 */
export function initTracing(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  host = process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL ?? host;
  if (!publicKey || !secretKey) {
    enabled = false;
    return;
  }
  const spanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: host,
  });
  sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
  sdk.start();
  enabled = true;
}

/** For tests: report whether tracing is live. */
export function tracingEnabled(): boolean {
  return enabled;
}

export interface TraceMeta {
  /** Run UUID. Key for looking the trace URL back up. */
  runId: string;
  name: string;
  metadata: Record<string, string>;
}

/** Open one trace (root span) for a whole run. The body's value passes through. */
export async function withTrace<T>(meta: TraceMeta, body: () => Promise<T>): Promise<T> {
  if (!enabled) return body();
  return startActiveObservation(
    meta.name,
    async (span) => {
      span.update({ input: meta.metadata });
      setActiveTraceAsPublic();
      const tid = getActiveTraceId();
      if (tid) traceIdByRun.set(meta.runId, tid);
      return body();
    },
    { endOnExit: true },
  ) as Promise<T>;
}

export interface ObserveUsage {
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Wrap one unit of work as a Langfuse generation span. `body` returns the value
 * the caller wants plus the usage to record. With tracing disabled, the body
 * still runs and its value is returned; usage is dropped.
 */
export async function observe<T>(
  name: string,
  info: { model: string; input?: unknown },
  body: () => Promise<{ value: T; usage?: ObserveUsage }>,
): Promise<T> {
  if (!enabled) {
    const { value } = await body();
    return value;
  }
  return startActiveObservation(
    name,
    async (gen) => {
      gen.update({ model: info.model, input: info.input });
      const { value, usage } = await body();
      const update: Record<string, unknown> = { output: usage?.output };
      if (usage?.inputTokens !== undefined) {
        update.usageDetails = {
          input: usage.inputTokens,
          output: usage.outputTokens ?? 0,
          total: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        };
      }
      if (usage?.costUsd !== undefined) {
        update.costDetails = { total: usage.costUsd };
      }
      gen.update(update);
      return value;
    },
    { asType: "generation", endOnExit: true },
  ) as Promise<T>;
}

/**
 * Build the public trace URL for a run id. Relies on the captured trace id, not
 * the `enabled` flag, so it still works after flushTracing() has shut the SDK
 * down (run.ts flushes before reading the URL).
 */
export function traceUrl(runId: string): string | undefined {
  const tid = traceIdByRun.get(runId);
  if (!tid) return undefined;
  return `${host}/trace/${tid}`;
}

/** Flush pending spans. Call once at the end of a run. Never throws. */
export async function flushTracing(): Promise<void> {
  if (!enabled || !sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // best effort; tracing is never allowed to fail a run
  } finally {
    enabled = false;
    sdk = undefined;
  }
}
