import { mkdirSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { computeIsoWeek } from './pipeline.js';

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
    default:
      console.log(JSON.stringify(args));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
