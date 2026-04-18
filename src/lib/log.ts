import pino from 'pino';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LoggerOptions {
  name: string;
  filePath?: string;
  level?: string;
}

const REDACT_PATHS = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  '*.ANTHROPIC_API_KEY',
  '*.VOYAGE_API_KEY',
  'headers.authorization',
  'headers.Authorization',
  '*.headers.authorization',
  '*.headers.Authorization',
];

export function makeLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level ?? (process.env.LOG_LEVEL as string) ?? 'info';
  const redactOpts = { paths: REDACT_PATHS, censor: '[Redacted]' };

  if (opts.filePath) {
    const dir = dirname(opts.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return pino(
      { name: opts.name, level, redact: redactOpts },
      pino.destination({ dest: opts.filePath, sync: false }),
    );
  }
  return pino({ name: opts.name, level, redact: redactOpts });
}
