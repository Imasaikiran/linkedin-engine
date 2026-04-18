import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Angle, Day, Draft, Polished } from '../lib/schema.js';
import { runVoiceGate, runHallucinationGate } from '../lib/gate.js';

export interface PolishOnceParams {
  client: Anthropic;
  draft: Draft;
  sources: { url: string; body: string }[];
  voiceCorpusUrls: string[];
  maxRetries: number;
  retryFn: (attempt: number, prevDraft: Draft, gateInfo: { voice_failures: string[]; hallucination_failures: string[] }) => Promise<Draft>;
}

export async function polishDraft(p: PolishOnceParams): Promise<Polished> {
  let current = p.draft;
  let lastVoice = runVoiceGate(current.post_text, { pillar: current.pillar });
  let lastHall = runHallucinationGate({ claims: current.claims, sources: p.sources, voiceCorpusUrls: p.voiceCorpusUrls });

  for (let attempt = 1; attempt <= p.maxRetries && (!lastVoice.pass || !lastHall.pass); attempt++) {
    current = await p.retryFn(attempt, current, {
      voice_failures: lastVoice.failures,
      hallucination_failures: lastHall.verdicts.filter((v) => v.verdict === 'FAIL').map((v) => v.reason),
    });
    lastVoice = runVoiceGate(current.post_text, { pillar: current.pillar });
    lastHall = runHallucinationGate({ claims: current.claims, sources: p.sources, voiceCorpusUrls: p.voiceCorpusUrls });
  }

  const ok = lastVoice.pass && lastHall.pass;
  return {
    draft: current,
    verdicts: lastHall.verdicts,
    voice_gate_pass: lastVoice.pass,
    voice_gate_failures: lastVoice.failures,
    hallucination_gate_pass: lastHall.pass,
    skipped: !ok,
    skipped_reason: ok ? undefined : `voice: ${lastVoice.failures.join('; ')} | claims: ${lastHall.verdicts.filter(v => v.verdict === 'FAIL').map(v => v.reason).join('; ')}`,
  };
}

const DAY_TITLES: Record<Day, string> = {
  mon: 'Monday',
  wed: 'Wednesday',
  fri: 'Friday',
};

const PILLAR_TITLE: Record<string, string> = {
  framework: 'Framework',
  hottake: 'Hot take',
  story: 'Inside the build',
  lesson: 'Lesson',
  myth: 'Myth-bust',
  observation: 'Observation',
  list: 'List',
};

export interface FormatParams {
  day: Day;
  draft: Draft;
  sources: { url: string; title?: string }[];
  gate_pass_rate: number;
}

export function formatFinalMarkdown(p: FormatParams): string {
  const sourcesBlock = p.sources.map((s) => `- [${s.title ?? s.url}](${s.url})`).join('\n');
  return `# ${DAY_TITLES[p.day]} — ${PILLAR_TITLE[p.draft.pillar] ?? p.draft.pillar}

${p.draft.post_text}

---

**Sources:**
${sourcesBlock}

**Why this angle:** ${p.draft.angle_rationale}

**Metadata:** pillar=${p.draft.pillar} | retries=${p.draft.attempt} | cost=$${p.draft.cost_usd.toFixed(2)} | gate_pass_rate=${Math.round(p.gate_pass_rate * 100)}%
`;
}

export interface RunPolishStageParams {
  client: Anthropic;
  dataDir: string;
  week: string;
  draftsRoot: string;
  voiceCorpusDir: string;
  retryFn: (attempt: number, prevDraft: Draft, gateInfo: { voice_failures: string[]; hallucination_failures: string[] }) => Promise<Draft>;
  maxRetries?: number;
}

export async function runPolishStage(p: RunPolishStageParams): Promise<Record<Day, Polished>> {
  const angles = JSON.parse(readFileSync(join(p.dataDir, 'angles', `${p.week}.json`), 'utf8')) as Angle[];
  const drafts = JSON.parse(readFileSync(join(p.dataDir, 'drafts', `${p.week}.json`), 'utf8')) as Record<Day, Draft>;
  const clusters = JSON.parse(readFileSync(join(p.dataDir, 'clusters', `${p.week}.json`), 'utf8')) as { items: { url: string; body: string; title: string }[] }[];

  const voiceCorpusUrls = collectVoiceCorpusUrls(p.voiceCorpusDir);
  const out: Record<string, Polished> = {};
  const outDir = join(p.draftsRoot, p.week);
  mkdirSync(outDir, { recursive: true });

  for (const angle of angles) {
    const draft = drafts[angle.day];
    if (!draft) continue;
    const cluster = clusters.find((c) => angle.cluster_urls.some((u) => c.items.some((i) => i.url === u)));
    const sources = cluster?.items.map((i) => ({ url: i.url, body: i.body, title: i.title })) ?? [];

    const polished = await polishDraft({
      client: p.client,
      draft,
      sources,
      voiceCorpusUrls,
      maxRetries: p.maxRetries ?? 2,
      retryFn: p.retryFn,
    });

    if (polished.skipped) {
      writeFileSync(join(outDir, `${angle.day}.SKIPPED.md`), `# ${angle.day} SKIPPED\n\n${polished.skipped_reason}\n`);
    } else {
      const passRate = polished.verdicts.length === 0 ? 1 : polished.verdicts.filter((v) => v.verdict === 'PASS').length / polished.verdicts.length;
      const md = formatFinalMarkdown({ day: angle.day, draft: polished.draft, sources: sources.map((s) => ({ url: s.url, title: s.title })), gate_pass_rate: passRate });
      polished.final_markdown = md;
      writeFileSync(join(outDir, `${angle.day}.md`), md);
    }
    out[angle.day] = polished;
  }
  return out as Record<Day, Polished>;
}

function collectVoiceCorpusUrls(dir: string): string[] {
  const urls: string[] = [];
  for (const sub of ['external', 'self']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    const meta = join(d, 'urls.json');
    if (existsSync(meta)) {
      try { urls.push(...(JSON.parse(readFileSync(meta, 'utf8')) as string[])); } catch { /* ignore */ }
    }
  }
  return urls;
}
