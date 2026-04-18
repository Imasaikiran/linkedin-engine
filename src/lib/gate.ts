import type { Pillar, Claim, ClaimVerdict } from './schema.js';

const BANNED_PHRASES = [
  'I recently', 'Excited to share', 'Today I want to share', "In today's",
  'game-changer', 'game changer', 'thought leader', 'deep dive', 'delve',
  'leverage', 'synergy', 'ecosystem', 'unpack', 'unlock',
  'Let that sink in', "Here's the thing", 'needless to say',
  'Furthermore', 'Moreover', 'In conclusion', "It's worth noting",
];

const BANNED_OPEN_EMOJIS = ['🚀', '✨', '🎯', '💡', '🔥'];
const ALL_EMOJIS_RE = /\p{Extended_Pictographic}/gu;

const WORD_COUNT_RANGES: Record<Pillar, [number, number]> = {
  framework: [150, 180],
  hottake: [120, 150],
  story: [180, 220],
  lesson: [160, 200],
  myth: [140, 170],
  observation: [130, 160],
  list: [150, 200],
};

export interface VoiceGateInput { pillar: Pillar; }
export interface VoiceGateResult { pass: boolean; failures: string[]; }

export function runVoiceGate(post: string, opts: VoiceGateInput): VoiceGateResult {
  const failures: string[] = [];

  if (post.includes('—')) failures.push('em-dash present');
  if (post.includes('–')) failures.push('en-dash present');

  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i');
    if (re.test(post)) failures.push(`banned phrase: "${phrase}"`);
  }

  const lines = post.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    failures.push('empty post');
    return { pass: false, failures };
  }

  const firstLine = lines[0]!;
  const firstWords = firstLine.split(/\s+/).filter(Boolean);
  if (firstWords.length < 8 || firstWords.length > 18) {
    failures.push(`first line word count ${firstWords.length} (need 8-18)`);
  }
  if (firstLine.endsWith('.')) failures.push('first line ends with period');
  if (BANNED_OPEN_EMOJIS.some((e) => firstLine.startsWith(e))) failures.push('opening emoji');

  const lastLine = lines[lines.length - 1]!;
  if (!lastLine.endsWith('?')) failures.push('last line not a question');

  const allWords = post.split(/\s+/).filter(Boolean);
  const [minW, maxW] = WORD_COUNT_RANGES[opts.pillar];
  if (allWords.length < minW || allWords.length > maxW) {
    failures.push(`word count ${allWords.length} outside ${minW}-${maxW} for pillar ${opts.pillar}`);
  }

  const emojis = post.match(ALL_EMOJIS_RE) ?? [];
  if (emojis.length > 2) failures.push(`emoji count ${emojis.length} > 2`);

  const hashtags = post.match(/#\w+/g) ?? [];
  if (hashtags.length > 3) failures.push(`hashtag count ${hashtags.length} > 3`);

  for (const para of post.split(/\n{2,}/)) {
    const lc = para.split('\n').filter((l) => l.trim().length > 0).length;
    if (lc > 3) failures.push(`paragraph has ${lc} lines (>3)`);
  }

  if (opts.pillar !== 'framework' && opts.pillar !== 'list') {
    if (/^\s*[-*\d]\.?\s+/m.test(post)) failures.push('bullet/numbered list in non-framework post');
  }

  const iCount = (post.match(/\bI\b/g) ?? []).length;
  if (allWords.length > 0 && iCount / allWords.length >= 0.05) {
    failures.push(`"I" frequency ${(iCount / allWords.length).toFixed(2)} >= 0.05`);
  }

  return { pass: failures.length === 0, failures };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ────────────────────────────────────────────────────────────────────────────
// Hallucination gate — claim source mapping
// ────────────────────────────────────────────────────────────────────────────

export interface HallGateInput {
  claims: Claim[];
  sources: { url: string; body: string }[];
  voiceCorpusUrls: string[];
}
export interface HallGateResult { pass: boolean; verdicts: ClaimVerdict[]; }

const PROPER_NOUN_RE = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b/;
const DIGIT_RE = /\d/;

export function runHallucinationGate(input: HallGateInput): HallGateResult {
  const verdicts: ClaimVerdict[] = [];

  for (const claim of input.claims) {
    if (claim.source_url && input.voiceCorpusUrls.includes(claim.source_url)) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'voice-corpus URL used as source' });
      continue;
    }

    if (claim.type === 'opinion') {
      if (DIGIT_RE.test(claim.claim_text)) {
        verdicts.push({ claim, verdict: 'FAIL', reason: 'opinion contains a digit (must be qualified as stat)' });
        continue;
      }
      if (PROPER_NOUN_RE.test(claim.claim_text)) {
        verdicts.push({ claim, verdict: 'FAIL', reason: 'opinion contains proper noun (must be attribution)' });
        continue;
      }
      verdicts.push({ claim, verdict: 'PASS', reason: 'opinion (whitelisted)' });
      continue;
    }

    if (!claim.source_url) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'non-opinion claim missing source_url' });
      continue;
    }
    const src = input.sources.find((s) => s.url === claim.source_url);
    if (!src) {
      verdicts.push({ claim, verdict: 'FAIL', reason: 'source_url not in cluster sources' });
      continue;
    }

    const v = mapClaim(claim, src.body);
    verdicts.push({ claim, ...v });
  }

  return { pass: verdicts.every((v) => v.verdict === 'PASS'), verdicts };
}

function mapClaim(claim: Claim, body: string): { verdict: 'PASS' | 'FAIL' | 'SOFT_FAIL'; reason: string; matched_excerpt?: string } {
  const lcBody = body.toLowerCase();
  switch (claim.type) {
    case 'stat': {
      const digits = claim.claim_text.match(/\d+(?:\.\d+)?[KkMmBbGg%]?/g) ?? [];
      if (digits.length === 0) return { verdict: 'FAIL', reason: 'stat has no digits' };
      for (const d of digits) {
        if (!body.toLowerCase().includes(d.toLowerCase())) {
          return { verdict: 'FAIL', reason: `digit "${d}" not in source` };
        }
      }
      return { verdict: 'PASS', reason: 'all digits present in source' };
    }
    case 'quote': {
      const quoted = claim.claim_text.match(/"([^"]+)"/);
      if (!quoted) return { verdict: 'FAIL', reason: 'quote claim has no quoted substring' };
      const target = quoted[1]!;
      if (lcBody.includes(target.toLowerCase())) {
        return { verdict: 'PASS', reason: 'exact quote in source', matched_excerpt: target };
      }
      return { verdict: 'FAIL', reason: 'quoted text not exact in source' };
    }
    case 'attribution': {
      const names = claim.claim_text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
      if (names.length === 0) return { verdict: 'FAIL', reason: 'attribution has no proper noun' };
      for (const n of names) {
        if (!body.includes(n)) return { verdict: 'FAIL', reason: `name "${n}" not in source` };
      }
      return { verdict: 'PASS', reason: 'all named persons appear in source' };
    }
    case 'capability': {
      const featureNouns = claim.claim_text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matched = featureNouns.filter((w) => lcBody.includes(w)).length;
      if (matched / Math.max(1, featureNouns.length) >= 0.6) {
        return { verdict: 'PASS', reason: `${matched}/${featureNouns.length} keywords matched` };
      }
      return { verdict: 'FAIL', reason: `only ${matched}/${featureNouns.length} keywords matched` };
    }
    case 'date': {
      const re = /\b(20\d{2})\b/;
      const m = claim.claim_text.match(re);
      if (!m) return { verdict: 'SOFT_FAIL', reason: 'date claim with no year' };
      if (body.includes(m[1]!)) return { verdict: 'PASS', reason: 'year present in source' };
      return { verdict: 'FAIL', reason: `year ${m[1]} not in source` };
    }
  }
  return { verdict: 'FAIL', reason: 'unknown claim type' };
}
