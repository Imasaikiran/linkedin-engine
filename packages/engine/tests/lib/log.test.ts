import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeLogger } from '../../src/lib/log.js';

describe('log', () => {
  it('redacts ANTHROPIC_API_KEY from log line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-test-'));
    const logFile = join(dir, 'out.log');
    const log = makeLogger({ name: 'test', filePath: logFile });
    log.info({ ANTHROPIC_API_KEY: 'sk-ant-secret', other: 'visible' }, 'hello');
    log.flush?.();
    return new Promise<void>((resolve) => setTimeout(() => {
      const content = readFileSync(logFile, 'utf8');
      expect(content).not.toContain('sk-ant-secret');
      expect(content).toContain('[Redacted]');
      expect(content).toContain('visible');
      resolve();
    }, 50));
  });
});
