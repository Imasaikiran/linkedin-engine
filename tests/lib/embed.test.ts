import { describe, it, expect, vi } from 'vitest';
import { cosine, embedTexts } from '../../src/lib/embed.js';

describe('embed', () => {
  it('cosine identity = 1', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it('cosine orthogonal = 0', () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });
  it('embedTexts uses Voyage when key set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.VOYAGE_API_KEY = 'pa-test';
    const out = await embedTexts(['hello']);
    expect(out[0]).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
