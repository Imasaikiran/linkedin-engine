import { describe, it, expect } from 'vitest';
import { runHallucinationGate } from '../../src/lib/gate.js';
import type { Claim } from '../../src/lib/schema.js';

const SOURCES = [
  { url: 'https://anthropic.com/news/claude-4-7', body: 'Claude 4.7 was released today. It supports a 200K context window and improved tool use. Sam Altman commented "this is a real shift" in a follow-up post.' },
];

describe('runHallucinationGate', () => {
  it('passes a stat that appears in source', () => {
    const claims: Claim[] = [{ claim_text: '200K context window', type: 'stat', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
    expect(r.verdicts[0]!.verdict).toBe('PASS');
  });

  it('fails a stat not in source', () => {
    const claims: Claim[] = [{ claim_text: '500K context window', type: 'stat', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(false);
  });

  it('passes opinion claims without source', () => {
    const claims: Claim[] = [{ claim_text: 'most teams overcomplicate evals', type: 'opinion', confidence: 0.5 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
  });

  it('rejects opinion claims with digits', () => {
    const claims: Claim[] = [{ claim_text: '70% of teams overcomplicate evals', type: 'opinion', confidence: 0.5 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(false);
  });

  it('rejects voice-corpus URLs as source_url', () => {
    const claims: Claim[] = [{ claim_text: '200K context', type: 'stat', source_url: 'https://linkedin.com/posts/akashgupta_x', confidence: 0.9 }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: ['https://linkedin.com/posts/akashgupta_x'] });
    expect(r.pass).toBe(false);
  });

  it('quote requires exact substring', () => {
    const ok: Claim[] = [{ claim_text: '"this is a real shift"', type: 'quote', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const bad: Claim[] = [{ claim_text: '"this is a huge shift"', type: 'quote', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    expect(runHallucinationGate({ claims: ok, sources: SOURCES, voiceCorpusUrls: [] }).pass).toBe(true);
    expect(runHallucinationGate({ claims: bad, sources: SOURCES, voiceCorpusUrls: [] }).pass).toBe(false);
  });

  it('attribution requires name + quote co-occurrence', () => {
    const ok: Claim[] = [{ claim_text: 'Sam Altman called it a real shift', type: 'attribution', source_url: 'https://anthropic.com/news/claude-4-7', confidence: 0.9 }];
    const r = runHallucinationGate({ claims: ok, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
  });

  it('rejects opinion with proper noun (mid-sentence capital name)', () => {
    const claims: Claim[] = [{
      claim_text: 'most teams overcomplicate evals because Sam Altman said so',
      type: 'opinion',
      confidence: 0.5,
    }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(false);
  });

  it('passes opinion that starts with a capital but has no real proper noun', () => {
    const claims: Claim[] = [{
      claim_text: 'Most teams overcomplicate evals',
      type: 'opinion',
      confidence: 0.5,
    }];
    const r = runHallucinationGate({ claims, sources: SOURCES, voiceCorpusUrls: [] });
    expect(r.pass).toBe(true);
  });
});
