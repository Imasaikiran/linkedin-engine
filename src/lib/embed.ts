export type Vector = number[];

export function cosine(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedTexts(texts: string[]): Promise<Vector[]> {
  if (texts.length === 0) return [];
  if (process.env.VOYAGE_API_KEY) {
    return embedVoyage(texts);
  }
  return embedLocal(texts);
}

async function embedVoyage(texts: string[]): Promise<Vector[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: 'voyage-3' }),
  });
  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status}`);
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

let xenovaPipe: any = null;
async function embedLocal(texts: string[]): Promise<Vector[]> {
  if (!xenovaPipe) {
    const { pipeline } = await import('@xenova/transformers');
    xenovaPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const out: Vector[] = [];
  for (const t of texts) {
    const e = await xenovaPipe(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(e.data as Float32Array));
  }
  return out;
}
