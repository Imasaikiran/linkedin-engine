import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpGet, clearCache } from '../../src/lib/fetch.js';

beforeEach(() => {
  clearCache();
  vi.restoreAllMocks();
});

describe('httpGet', () => {
  it('sends User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('hi', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.USER_AGENT = 'linkedin-engine/0.1 test';
    const res = await httpGet('https://example.com/x');
    expect(res.body).toBe('hi');
    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['user-agent']).toBe('linkedin-engine/0.1 test');
  });

  it('returns cached body within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('cached', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await httpGet('https://example.com/y');
    await httpGet('https://example.com/y');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await httpGet('https://example.com/z', { retries: 2, retryDelayMs: 1 });
    expect(res.body).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausted retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(httpGet('https://example.com/q', { retries: 1, retryDelayMs: 1 })).rejects.toThrow(/HTTP 500/);
  });
});
