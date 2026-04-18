import type { Pillar } from './schema.js';

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
