import { describe, it, expect } from 'vitest';
import { runVoiceGate } from '../../src/lib/gate.js';
import { loadBrand, type Brand } from '../../src/lib/brand.js';

const BRAND: Brand = loadBrand('../../examples/sai-voice/brand.yaml');

/** Deep-clone the brand so individual tests can mutate without bleeding state. */
function cloneBrand(b: Brand = BRAND): Brand {
  return JSON.parse(JSON.stringify(b)) as Brand;
}

/**
 * Build a post with a controlled word count, hook length, paragraph shape, and
 * trailing punctuation. All other tests should consume this so we can isolate
 * the rule under test.
 */
function buildPost(opts: {
  hookWords?: number;
  bodyWords?: number;
  paragraphLines?: number;
  endWithQuestion?: boolean;
  bodyPrefix?: string;
} = {}): string {
  const hookWords = opts.hookWords ?? 8;
  const bodyWords = opts.bodyWords ?? 240;
  const paragraphLines = opts.paragraphLines ?? 3;
  const endWithQuestion = opts.endWithQuestion ?? true;

  const hookPool = ['What', 'if', 'every', 'release', 'felt', 'like', 'a', 'product', 'launch', 'today', 'tomorrow', 'always', 'never', 'maybe', 'still'];
  const hook = Array.from({ length: hookWords }, (_, i) => hookPool[i % hookPool.length]!).join(' ');

  // Use a varied vocabulary so we don't accidentally match banned phrases or
  // trigger high "I" frequency. Avoid the literal token "I".
  const filler = ['Teams', 'ship', 'work', 'with', 'narrative', 'and', 'numbers', 'that', 'land', 'cleanly'];
  const wordsNeeded = Math.max(0, bodyWords - hookWords);
  const tokens: string[] = [];
  for (let i = 0; i < wordsNeeded; i++) tokens.push(filler[i % filler.length]!);

  // Distribute tokens across paragraphs of `paragraphLines` lines, with ~5 words/line.
  const wordsPerLine = 5;
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerLine) {
    lines.push(tokens.slice(i, i + wordsPerLine).join(' '));
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < lines.length; i += paragraphLines) {
    paragraphs.push(lines.slice(i, i + paragraphLines).join('\n'));
  }

  const closing = endWithQuestion ? 'Does your team agree' : 'Final thought lands here';
  const closingLine = endWithQuestion ? `${closing}?` : `${closing}.`;

  const prefix = opts.bodyPrefix ? `${opts.bodyPrefix}\n\n` : '';
  return `${hook}\n\n${prefix}${paragraphs.join('\n\n')}\n\n${closingLine}`;
}

describe('runVoiceGate', () => {
  it('passes a clean post', () => {
    const post = buildPost();
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails on em dash', () => {
    const post = buildPost({ bodyPrefix: 'Body — with an em dash kills it' });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/em.?dash/i);
  });

  it('fails on banned phrase from brand.yaml', () => {
    // "game-changer" lives in brand.yaml banned_phrases.
    const post = buildPost({ bodyPrefix: 'This is the real game-changer here' });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/game-changer/i);
  });

  it('fails on word count out of range', () => {
    const post = buildPost({ bodyWords: 50 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'framework' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/word count/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // banned_openers
  // ───────────────────────────────────────────────────────────────────────────

  it('fails when post starts with a brand-banned opener', () => {
    // "I recently" is in brand.yaml banned_openers.
    const post = `I recently shipped a thing worth talking about today\n\n${buildPost().split('\n').slice(2).join('\n')}`;
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/banned opener.*I recently/i);
  });

  it('banned-opener check is case-insensitive', () => {
    const post = `i RECENTLY shipped a thing worth talking about today\n\n${buildPost().split('\n').slice(2).join('\n')}`;
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/banned opener/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // banned_phrases adjustability
  // ───────────────────────────────────────────────────────────────────────────

  it('banned_phrases is adjustable via brand', () => {
    const post = buildPost({ bodyPrefix: 'This contains foobar somewhere in it' });

    // Without modification: 'foobar' is not banned.
    const baseline = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(baseline.failures.join(' ')).not.toMatch(/foobar/);

    // Clone + add foobar: now it fails.
    const custom = cloneBrand();
    custom.voice.must_not_have.banned_phrases.push('foobar');
    const r = runVoiceGate(post, { brand: custom, pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/foobar/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // target_words from brand
  // ───────────────────────────────────────────────────────────────────────────

  it('target_words: 100-word post fails (under brand range)', () => {
    const post = buildPost({ bodyWords: 100 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/word count/);
  });

  it('target_words: 250-word post passes the word-count check', () => {
    const post = buildPost({ bodyWords: 250 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.filter((f) => /word count/.test(f))).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // target_chars from brand
  // ───────────────────────────────────────────────────────────────────────────

  it('target_chars: oversized post fails the char-count check', () => {
    // 5000 words at ~5 chars/word = ~25k chars, well past brand max of 1700.
    const post = buildPost({ bodyWords: 5000 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/char count/);
  });

  it('target_chars: in-range post passes the char-count check', () => {
    const post = buildPost();
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.filter((f) => /char count/.test(f))).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // hook_max_words from brand
  // ───────────────────────────────────────────────────────────────────────────

  it('hook_max_words: 16-word first line fails (brand max=14)', () => {
    const post = buildPost({ hookWords: 16 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/first line word count/);
  });

  it('hook_max_words: 8-word first line passes the hook check', () => {
    const post = buildPost({ hookWords: 8 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.filter((f) => /first line word count/.test(f))).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // paragraph_max_lines from brand
  // ───────────────────────────────────────────────────────────────────────────

  it('paragraph_max_lines: 4-line paragraph passes when brand is set to 5', () => {
    const post = buildPost({ paragraphLines: 4 });
    const custom = cloneBrand();
    custom.voice.rhythm.paragraph_max_lines = 5;
    const r = runVoiceGate(post, { brand: custom, pillar: 'hottake' });
    expect(r.failures.filter((f) => /paragraph has/.test(f))).toEqual([]);
  });

  it('paragraph_max_lines: 5-line paragraph fails with default brand (=4)', () => {
    const post = buildPost({ paragraphLines: 5 });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/paragraph has/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // em_dashes / en_dashes toggle
  // ───────────────────────────────────────────────────────────────────────────

  it('em_dashes toggle: when false, em-dash does not fail', () => {
    const custom = cloneBrand();
    custom.voice.must_not_have.em_dashes = false;
    const post = buildPost({ bodyPrefix: 'Body — with an em dash is fine now' });
    const r = runVoiceGate(post, { brand: custom, pillar: 'hottake' });
    expect(r.failures.filter((f) => /em.?dash/i.test(f))).toEqual([]);
  });

  it('en_dashes toggle: when false, en-dash does not fail', () => {
    const custom = cloneBrand();
    custom.voice.must_not_have.en_dashes = false;
    const post = buildPost({ bodyPrefix: 'Body – with an en dash is fine now' });
    const r = runVoiceGate(post, { brand: custom, pillar: 'hottake' });
    expect(r.failures.filter((f) => /en.?dash/i.test(f))).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // closing_question_optional
  // ───────────────────────────────────────────────────────────────────────────

  it('closing_question_optional=true (brand default): non-question ending does NOT fail', () => {
    const post = buildPost({ endWithQuestion: false });
    const r = runVoiceGate(post, { brand: BRAND, pillar: 'hottake' });
    expect(r.failures.filter((f) => /question/i.test(f))).toEqual([]);
  });

  it('closing_question_optional=false: non-question ending DOES fail', () => {
    const custom = cloneBrand();
    custom.engagement.closing_question_optional = false;
    const post = buildPost({ endWithQuestion: false });
    const r = runVoiceGate(post, { brand: custom, pillar: 'hottake' });
    expect(r.failures.join(' ')).toMatch(/last line not a question/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // brand cadence pillars accepted by first-person threshold
  // ───────────────────────────────────────────────────────────────────────────

  it('brand cadence pillar "shipped" gets the wider 0.15 first-person band', () => {
    // Build a post with ~10% "I" frequency: passes 0.15 but fails 0.08.
    // 240 body words ⇒ 24 "I"s should yield ~10%.
    const post = buildPost();
    const allWords = post.split(/\s+/).filter(Boolean).length;
    const targetCount = Math.floor(allWords * 0.10);
    const iLine = Array(targetCount).fill('I').join(' ');
    const withIs = `${post}\n\n${iLine}`;

    const shippedR = runVoiceGate(withIs, { brand: BRAND, pillar: 'shipped' });
    const frameworkR = runVoiceGate(withIs, { brand: BRAND, pillar: 'framework' });

    expect(shippedR.failures.filter((f) => /"I" frequency/.test(f))).toEqual([]);
    expect(frameworkR.failures.join(' ')).toMatch(/"I" frequency/);
  });

  it('brand cadence pillar "critique" gets the wider 0.15 first-person band', () => {
    const post = buildPost();
    const allWords = post.split(/\s+/).filter(Boolean).length;
    const targetCount = Math.floor(allWords * 0.10);
    const iLine = Array(targetCount).fill('I').join(' ');
    const withIs = `${post}\n\n${iLine}`;

    const r = runVoiceGate(withIs, { brand: BRAND, pillar: 'critique' });
    expect(r.failures.filter((f) => /"I" frequency/.test(f))).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // pillar normalization (defensive against caller casing/whitespace)
  // ───────────────────────────────────────────────────────────────────────────

  it('pillar input is normalized: " Shipped " behaves identically to "shipped"', () => {
    // Build a post in the 0.10 first-person band: passes the wider 0.15 (shipped)
    // but fails the strict 0.08 (default). If pillar normalization is missing,
    // " Shipped " would fall through to the strict 0.08 bucket and fail.
    const post = buildPost();
    const allWords = post.split(/\s+/).filter(Boolean).length;
    const targetCount = Math.floor(allWords * 0.10);
    const iLine = Array(targetCount).fill('I').join(' ');
    const withIs = `${post}\n\n${iLine}`;

    const canonical = runVoiceGate(withIs, { brand: BRAND, pillar: 'shipped' });
    const padded = runVoiceGate(withIs, { brand: BRAND, pillar: ' Shipped ' });

    expect(padded.pass).toBe(canonical.pass);
    expect(padded.failures).toEqual(canonical.failures);
    expect(padded.failures.filter((f) => /"I" frequency/.test(f))).toEqual([]);
  });
});
