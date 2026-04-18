import { describe, it, expect } from 'vitest';
import { computeIsoWeek } from '../src/pipeline.js';

describe('pipeline helpers', () => {
  it('computeIsoWeek for known date', () => {
    expect(computeIsoWeek(new Date('2026-04-20T00:00:00Z'))).toBe('2026-W17');
  });
});
