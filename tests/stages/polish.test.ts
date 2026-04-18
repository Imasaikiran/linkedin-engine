// tests/stages/polish.test.ts
import { describe, it, expect, vi } from 'vitest';
import { polishDraft, formatFinalMarkdown } from '../../src/stages/polish.js';
import type { Draft } from '../../src/lib/schema.js';

const cleanDraft: Draft = {
  post_text: `What if every model release felt like a real product launch instead of a quiet engineering milestone

Most teams ship a checkpoint, post a benchmark, and call it a day.
The result the release lands once, earns a quarter of the attention it deserved, and quietly fades.
Three reasons that costs you reach next quarter.

First, no narrative around what actually changed for the people who pay you.
Second, no positioning relative to what shipped last quarter or what a competitor put out this week.
Third, no question for the reader, no hook to start a conversation that day.

Releases without these three pieces still ship and still hit revenue targets.
They also leave reach on the table that competitors quietly pick up over the months that follow.
Fix that and your release lands twice as hard.

What does your team actually do on launch day?`,
  claims: [{ claim_text: 'every model release', type: 'opinion', confidence: 0.6 }],
  pillar: 'hottake',
  angle_rationale: 'cadence > capability',
  attempt: 0,
  cost_usd: 0,
};

describe('polish', () => {
  it('passes a clean draft', async () => {
    const fakeClient = { messages: { create: vi.fn() } } as any;
    const out = await polishDraft({
      client: fakeClient,
      draft: cleanDraft,
      sources: [],
      voiceCorpusUrls: [],
      maxRetries: 0,
      retryFn: async () => cleanDraft,
    });
    expect(out.skipped).toBe(false);
    expect(out.voice_gate_pass).toBe(true);
    expect(out.hallucination_gate_pass).toBe(true);
  });

  it('marks skipped after maxRetries fail', async () => {
    const badDraft: Draft = { ...cleanDraft, post_text: 'too short — em dash here\nhi\n?' };
    const out = await polishDraft({
      client: { messages: { create: vi.fn() } } as any,
      draft: badDraft,
      sources: [],
      voiceCorpusUrls: [],
      maxRetries: 2,
      retryFn: async () => badDraft,
    });
    expect(out.skipped).toBe(true);
    expect(out.skipped_reason).toBeTruthy();
  });

  it('formatFinalMarkdown includes sources block + metadata', () => {
    const md = formatFinalMarkdown({
      day: 'fri',
      draft: cleanDraft,
      sources: [{ url: 'https://x/1', title: 'X' }],
      gate_pass_rate: 1,
    });
    expect(md).toContain('# Friday — Hot take');
    expect(md).toContain('https://x/1');
    expect(md).toContain('pillar=hottake');
  });
});
