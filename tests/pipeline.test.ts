import { describe, it, expect } from 'vitest';
import { computeIsoWeek, dateForDay } from '../src/legacy-pipeline.js';

describe('pipeline helpers', () => {
  it('computeIsoWeek for known date', () => {
    expect(computeIsoWeek(new Date('2026-04-20T00:00:00Z'))).toBe('2026-W17');
  });
  it('dateForDay maps mon/wed/fri of W17 2026', () => {
    expect(dateForDay('2026-W17', 'mon')).toBe('2026-04-20');
    expect(dateForDay('2026-W17', 'wed')).toBe('2026-04-22');
    expect(dateForDay('2026-W17', 'fri')).toBe('2026-04-24');
  });
});
