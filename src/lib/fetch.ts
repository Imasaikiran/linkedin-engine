const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cache = new Map<string, { body: string; status: number; ts: number }>();

export interface HttpOptions {
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpResponse {
  body: string;
  status: number;
  fromCache: boolean;
}

export function clearCache(): void {
  cache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { body: cached.body, status: cached.status, fromCache: true };
  }

  const ua = process.env.USER_AGENT ?? 'linkedin-engine/0.1';
  const headers: Record<string, string> = { 'user-agent': ua, ...(opts.headers ?? {}) };
  const retries = opts.retries ?? 3;
  const retryDelay = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status >= 500 && attempt < retries) {
        await sleep(retryDelay * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const body = await res.text();
      cache.set(url, { body, status: res.status, ts: Date.now() });
      return { body, status: res.status, fromCache: false };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await sleep(retryDelay * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
