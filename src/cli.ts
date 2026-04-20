import { mkdirSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VoiceHandle } from './voice-refresh.js';
import { computeIsoWeek } from './legacy-pipeline.js';

export type CliArgs =
  | { cmd: 'stage'; name: string; flags: Record<string, string> }
  | { cmd: 'rerun'; flags: Record<string, string> }
  | { cmd: 'voice:refresh'; flags: Record<string, string> }
  | { cmd: 'posted'; day: string; flags: Record<string, string> }
  | { cmd: 'draft:freeform'; flags: Record<string, string> }
  | { cmd: 'help' };

export function parseCliArgs(argv: string[]): CliArgs {
  const [cmd, ...rest] = argv;
  if (!cmd) return { cmd: 'help' };
  if (cmd === 'stage') {
    const [name, ...kv] = rest;
    return { cmd: 'stage', name: name ?? '', flags: parseKv(kv) };
  }
  if (cmd === 'posted') {
    const [day, ...kv] = rest;
    return { cmd: 'posted', day: day ?? '', flags: parseKv(kv) };
  }
  if (cmd === 'rerun' || cmd === 'voice:refresh' || cmd === 'draft:freeform') {
    return { cmd: cmd as any, flags: parseKv(rest) };
  }
  return { cmd: 'help' };
}

function parseKv(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!;
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = args[i + 1] ?? '';
      out[key] = val;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'help':
      console.log('usage: cli <stage|rerun|voice:refresh|posted|draft:freeform> ...');
      return;
    case 'posted': {
      const week = args.flags.week ?? computeIsoWeek(new Date());
      const draftPath = join(process.cwd(), 'drafts', week, `${args.day}.md`);
      if (!existsSync(draftPath)) {
        console.error(`no draft at ${draftPath}`);
        process.exitCode = 1; return;
      }
      const postedDir = join(process.cwd(), 'posted', week);
      mkdirSync(postedDir, { recursive: true });
      const dest = join(postedDir, `${args.day}.md`);
      renameSync(draftPath, dest);
      const meta = join(postedDir, `${args.day}.json`);
      writeFileSync(meta, JSON.stringify({ url: args.flags.url, posted_at: new Date().toISOString(), source_file: basename(dest) }, null, 2));
      console.log(`marked posted: ${args.day} (${args.flags.url})`);
      return;
    }
    case 'voice:refresh': {
      const { parse: parseYaml } = await import('yaml');
      const { readFileSync } = await import('node:fs');
      const { refreshVoiceCorpus } = await import('./voice-refresh.js');
      const cfg = parseYaml(readFileSync(join(process.cwd(), 'config', 'sources.yaml'), 'utf8'));
      const out = await refreshVoiceCorpus({
        handles: (cfg as { voice_handles: VoiceHandle[] }).voice_handles,
        outDir: join(process.cwd(), 'data', 'voice-corpus'),
        samplesPerHandle: 5,
      });
      console.log(out);
      return;
    }
    case 'stage': {
      await runStage(args.name, args.flags);
      return;
    }
    case 'rerun': {
      const stage = args.flags.stage;
      if (!stage) { console.error('rerun requires --stage <name>'); process.exitCode = 1; return; }
      await runStage(stage, args.flags);
      return;
    }
    default:
      console.log(JSON.stringify(args));
  }
}

async function runStage(name: string, flags: Record<string, string>): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const week = flags.week ?? computeIsoWeek(new Date());
  const dataDir = join(process.cwd(), 'data');
  switch (name) {
    case 'scrape': {
      const { runScrape } = await import('./stages/scrape.js');
      const sourcesYaml = readFileSync(join(process.cwd(), 'config', 'sources.yaml'), 'utf8');
      const r = await runScrape({ sourcesYaml, week, dataDir });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'cluster': {
      const { runCluster } = await import('./stages/cluster.js');
      const r = await runCluster({ dataDir, week });
      console.log(`clusters: ${r.length}`);
      return;
    }
    case 'score': {
      const { runScore } = await import('./stages/score.js');
      const r = runScore({ dataDir, week });
      console.log(`scored clusters: ${r.length}`);
      return;
    }
    case 'angle': {
      const { runAngleStage } = await import('./stages/angle.js');
      const { makeClient } = await import('./lib/llm.js');
      const r = await runAngleStage({
        client: makeClient(), dataDir, week,
        promptPath: join(process.cwd(), 'prompts', 'pick-angle.md'),
      });
      console.log(`angles: ${r.angles.length}, cost=$${r.cost_usd.toFixed(4)}`);
      return;
    }
    case 'draft': {
      const { runDraftStage } = await import('./stages/draft.js');
      const { makeClient } = await import('./lib/llm.js');
      const { parse: parseYaml } = await import('yaml');
      const pillarsCfg = parseYaml(readFileSync(join(process.cwd(), 'config', 'pillars.yaml'), 'utf8')) as { voice_corpus?: { samples_per_draft?: number } };
      const r = await runDraftStage({
        client: makeClient(), dataDir, week,
        voiceSystemPath: join(process.cwd(), 'prompts', 'voice-system.md'),
        pillarPromptDir: join(process.cwd(), 'prompts', 'pillars'),
        voiceCorpusDir: join(dataDir, 'voice-corpus'),
        samplesPerDraft: pillarsCfg.voice_corpus?.samples_per_draft ?? 3,
      });
      console.log(`drafts: ${Object.keys(r.drafts).length}, cost=$${r.cost_usd.toFixed(4)}`);
      return;
    }
    case 'polish': {
      const { runPolishStage } = await import('./stages/polish.js');
      const { makeClient } = await import('./lib/llm.js');
      const { makeRetry } = await import('./legacy-pipeline.js');
      const client = makeClient();
      const r = await runPolishStage({
        client, dataDir, week,
        draftsRoot: join(process.cwd(), 'drafts'),
        voiceCorpusDir: join(dataDir, 'voice-corpus'),
        retryFn: async (attempt, prev, info) => makeRetry(client, prev, info, attempt),
        maxRetries: 2,
      });
      const skipped = Object.values(r).filter((p) => p.skipped).length;
      console.log(`polished: ${Object.keys(r).length - skipped} produced, ${skipped} skipped`);
      return;
    }
    default:
      console.error(`unknown stage: ${name}. expected one of scrape|cluster|score|angle|draft|polish`);
      process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
