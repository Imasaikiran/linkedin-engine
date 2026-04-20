// tests/stages/polish.test.ts
import { describe, it, expect, vi } from 'vitest';
import { polishDraft, formatFinalMarkdown } from '../../src/stages/polish.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';
import type { Draft } from '../../src/lib/schema.js';

const BRAND: Brand = loadBrand();

// Lock in the rhythm values that match `cleanDraft` below so this test does not
// silently break if brand.yaml drifts. Cloning the loaded brand keeps every other
// rule (banned phrases/openers, dashes, engagement) honest while pinning the
// numeric bands the fixture was sized against.
const FIXTURE_BRAND: Brand = {
  ...BRAND,
  voice: {
    ...BRAND.voice,
    rhythm: {
      ...BRAND.voice.rhythm,
      target_words: [220, 280],
      target_chars: [1300, 1700],
      hook_max_words: 10,
      paragraph_max_lines: 3,
    },
  },
};

// Sized to FIXTURE_BRAND.voice.rhythm: hook ≤10 words, 220-280 total words,
// 1300-1700 chars, paragraphs ≤3 lines, no banned openers or phrases.
const cleanDraft: Draft = {
  post_text: `What if every model release felt like a launch

Most teams ship a checkpoint and call it a quiet engineering milestone.
The result lands once, earns a quarter of the attention it deserved, and fades.
Three reasons that costs you reach next quarter.

First, no narrative around what actually changed for the people who pay you.
Second, no positioning relative to what shipped last quarter or what a competitor put out this week.
Third, no question for the reader, no hook to start a real conversation that day.

Releases without those three pieces still ship and still hit revenue targets.
They also leave reach on the table that competitors quietly pick up over the months that follow.
Fix that pattern and your next release will land twice as hard with half the spend.

A clear narrative beats a clever benchmark every single week.
Specific numbers beat vague adjectives every single time.
Concrete examples beat abstract claims every single post.

Teams that nail those three pieces grow share of voice while the room is still loading the page.
Teams that skip them get a changelog and silence inside of forty eight hours from posting.
That gap compounds across launches, across quarters, and across hiring rounds you might not even see.

What does your team actually do on launch day to break out of the changelog trap before the close of business?`,
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
      brand: FIXTURE_BRAND,
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
      brand: FIXTURE_BRAND,
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
