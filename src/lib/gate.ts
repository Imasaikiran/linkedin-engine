import type { Claim, ClaimVerdict } from './schema.js';
import type { Brand } from './brand.js';

const BANNED_OPEN_EMOJIS = ['🚀', '✨', '🎯', '💡', '🔥'];
const ALL_EMOJIS_RE = /\p{Extended_Pictographic}/gu;

// First-person POV pillars get a wider 0.15 "I" frequency band. Others cap at 0.08
// to discourage navel-gazing. Covers both legacy `Pillar` enum values and the
// new brand cadence pillar names from `brand.yaml`.
const FIRST_PERSON_POV_PILLARS = new Set(['story', 'lesson', 'shipped', 'critique']);

// Pillars where bullet/numbered lists are expected. `framework` covers both legacy
// and brand cadence; `list` is legacy-only.
const LIST_FRIENDLY_PILLARS = new Set(['framework', 'list']);

export interface VoiceGateInput {
  brand: Brand;
  /** Pillar string. Brand cadence values (shipped/framework/critique) OR legacy PillarEnum. */
  pillar: string;
}
export interface VoiceGateResult { pass: boolean; failures: string[]; }

export function runVoiceGate(post: string, opts: VoiceGateInput): VoiceGateResult {
  const { brand, pillar } = opts;
  const { must_not_have, rhythm } = brand.voice;
  const failures: string[] = [];

  if (must_not_have.em_dashes && post.includes('—')) failures.push('em-dash present');
  if (must_not_have.en_dashes && post.includes('–')) failures.push('en-dash present');

  for (const phrase of must_not_have.banned_phrases) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i');
    if (re.test(post)) failures.push(`banned phrase: "${phrase}"`);
  }

  const trimmedStart = post.trimStart().toLowerCase();
  for (const opener of must_not_have.banned_openers) {
    if (trimmedStart.startsWith(opener.toLowerCase())) {
      failures.push(`banned opener: "${opener}"`);
    }
  }

  const lines = post.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    failures.push('empty post');
    return { pass: false, failures };
  }

  const firstLine = lines[0]!;
  const firstWords = firstLine.split(/\s+/).filter(Boolean);
  if (firstWords.length > rhythm.hook_max_words) {
    failures.push(`first line word count ${firstWords.length} (max ${rhythm.hook_max_words})`);
  }
  if (firstLine.endsWith('.')) failures.push('first line ends with period');
  if (BANNED_OPEN_EMOJIS.some((e) => firstLine.startsWith(e))) failures.push('opening emoji');

  // Closing-question check is opt-in via brand. When `closing_question_optional` is true
  // (the brand.yaml default), skip the check entirely.
  if (brand.engagement.closing_question_optional === false) {
    const lastLine = lines[lines.length - 1]!;
    if (!lastLine.endsWith('?')) failures.push('last line not a question');
  }

  const allWords = post.split(/\s+/).filter(Boolean);
  const [minW, maxW] = rhythm.target_words;
  if (allWords.length < minW || allWords.length > maxW) {
    failures.push(`word count ${allWords.length} outside ${minW}-${maxW}`);
  }

  const [minC, maxC] = rhythm.target_chars;
  if (post.length < minC || post.length > maxC) {
    failures.push(`char count ${post.length} outside ${minC}-${maxC}`);
  }

  const emojis = post.match(ALL_EMOJIS_RE) ?? [];
  if (emojis.length > 2) failures.push(`emoji count ${emojis.length} > 2`);

  const hashtags = post.match(/#\w+/g) ?? [];
  if (hashtags.length > 3) failures.push(`hashtag count ${hashtags.length} > 3`);

  for (const para of post.split(/\n{2,}/)) {
    const lc = para.split('\n').filter((l) => l.trim().length > 0).length;
    if (lc > rhythm.paragraph_max_lines) {
      failures.push(`paragraph has ${lc} lines (>${rhythm.paragraph_max_lines})`);
    }
  }

  if (!LIST_FRIENDLY_PILLARS.has(pillar)) {
    if (/^\s*[-*\d]\.?\s+/m.test(post)) failures.push('bullet/numbered list in non-framework post');
  }

  const iThreshold = FIRST_PERSON_POV_PILLARS.has(pillar) ? 0.15 : 0.08;
  const iCount = (post.match(/\bI\b/g) ?? []).length;
  if (allWords.length > 0 && iCount / allWords.length >= iThreshold) {
    failures.push(`"I" frequency ${(iCount / allWords.length).toFixed(2)} >= ${iThreshold}`);
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

const DIGIT_RE = /\d/;

// Acronyms + brand/product names that legitimately appear in opinion text without being attribution claims.
const PROPER_NOUN_WHITELIST = new Set([
  'AI', 'AGI', 'API', 'LLM', 'LLMs', 'ML', 'GPT', 'RAG', 'MCP', 'SDK', 'CLI', 'IDE', 'PM', 'PMs',
  'CEO', 'CTO', 'PR', 'QA', 'UX', 'UI', 'OS', 'OSS', 'SaaS', 'B2B', 'B2C', 'KPI', 'OKR', 'ROI',
  'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'Meta', 'Google', 'Microsoft', 'Apple', 'GitHub',
  'LinkedIn', 'Twitter', 'X', 'YouTube', 'Reddit', 'HN', 'Slack', 'Notion', 'Figma',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

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
      if (containsProperNoun(claim.claim_text)) {
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
      const normalizedClaim = normalizeQuotes(claim.claim_text);
      const quoted = normalizedClaim.match(/"([^"]+)"/);
      if (!quoted) return { verdict: 'FAIL', reason: 'quote claim has no quoted substring' };
      const target = quoted[1]!.toLowerCase();
      const normalizedBody = normalizeQuotes(body).toLowerCase();
      if (normalizedBody.includes(target)) {
        return { verdict: 'PASS', reason: 'exact quote in source', matched_excerpt: quoted[1] };
      }
      return { verdict: 'FAIL', reason: 'quoted text not exact in source' };
    }
    case 'attribution': {
      const names = claim.claim_text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b/g) ?? [];
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

// Detects proper nouns: capitalized words that are NOT sentence-initial and NOT in the whitelist.
function containsProperNoun(text: string): boolean {
  const stripped = text
    .replace(/^[^.!?]*?(\s|$)/, (match) => ' '.repeat(match.length))
    .replace(/(?<=[.!?]\s)[A-Za-z][a-zA-Z]*/g, (m) => ' '.repeat(m.length));
  const matches = stripped.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b/g) ?? [];
  for (const m of matches) {
    const tokens = m.split(/\s+/);
    if (tokens.some((t) => !PROPER_NOUN_WHITELIST.has(t))) return true;
  }
  return false;
}
