import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/cli.js';

describe('cli', () => {
  it('parses stage subcommand', () => {
    expect(parseCliArgs(['stage', 'scrape', '--week', '2026-W17'])).toEqual({ cmd: 'stage', name: 'scrape', flags: { week: '2026-W17' } });
  });
  it('parses posted subcommand', () => {
    expect(parseCliArgs(['posted', 'fri', '--url', 'https://x/y'])).toEqual({ cmd: 'posted', day: 'fri', flags: { url: 'https://x/y' } });
  });
  it('parses draft:freeform', () => {
    expect(parseCliArgs(['draft:freeform', '--topic', 'X', '--pillar', 'hottake'])).toEqual({ cmd: 'draft:freeform', flags: { topic: 'X', pillar: 'hottake' } });
  });
});
