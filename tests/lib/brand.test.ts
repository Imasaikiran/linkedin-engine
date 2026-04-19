import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrandSchema, loadBrand } from '../../src/lib/brand.js';

const REPO_ROOT = process.cwd();
const REPO_BRAND = path.join(REPO_ROOT, 'brand.yaml');

describe('brand', () => {
  it('loadBrand reads the actual repo brand.yaml without throwing', () => {
    const brand = loadBrand();
    expect(brand.identity.role.length).toBeGreaterThan(0);
    expect(brand.identity.audience.primary.length).toBeGreaterThan(0);
    expect(brand.voice.rhythm.target_words[0]).toBeLessThanOrEqual(brand.voice.rhythm.target_words[1]);
  });

  it('loadBrand with explicit path works', () => {
    const brand = loadBrand(REPO_BRAND);
    expect(brand.identity.goal.length).toBeGreaterThan(0);
    expect(brand.agents.scout.model).toBe('claude-haiku-4-5');
    expect(brand.agents.drafter.parallel).toBe(true);
  });

  it('all 3 cadence days (mon/wed/fri) parse correctly', () => {
    const brand = loadBrand();
    for (const day of ['mon', 'wed', 'fri'] as const) {
      const cfg = brand.cadence[day];
      expect(cfg.pillar.length).toBeGreaterThan(0);
      expect(cfg.template.length).toBeGreaterThan(0);
      expect(cfg.requires.length).toBeGreaterThan(0);
    }
    expect(brand.cadence.mon.pillar).toBe('shipped');
    expect(brand.cadence.wed.pillar).toBe('framework');
    expect(brand.cadence.fri.pillar).toBe('critique');
  });

  it("schema-invalid YAML throws with 'brand.yaml' in message", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'brand-test-'));
    const bad = path.join(dir, 'brand.yaml');
    writeFileSync(bad, 'identity:\n  role: 123\n', 'utf8'); // role should be string + missing fields
    try {
      expect(() => loadBrand(bad)).toThrow(/brand\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('malformed YAML (unterminated string) throws with "brand.yaml" in message', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'brand-test-'));
    const bad = path.join(dir, 'brand.yaml');
    writeFileSync(bad, 'identity:\n  role: "unclosed string\n  goal: x\n', 'utf8');
    try {
      expect(() => loadBrand(bad)).toThrow(/brand\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadBrand throws clear message when file is missing', () => {
    const missing = path.join(tmpdir(), 'definitely-not-here-brand.yaml');
    expect(() => loadBrand(missing)).toThrow(/brand\.yaml/);
  });

  it('BrandSchema rejects out-of-enum white_space', () => {
    const baseline = loadBrand();
    const tampered = { ...baseline, engagement: { ...baseline.engagement, white_space: 'WAY_TOO_MUCH' } };
    const res = BrandSchema.safeParse(tampered);
    expect(res.success).toBe(false);
  });

  it('BrandSchema rejects payload missing top-level agents section', () => {
    const brand = loadBrand();
    const tampered = JSON.parse(JSON.stringify(brand));
    delete tampered.agents;
    const res = BrandSchema.safeParse(tampered);
    expect(res.success).toBe(false);
  });

  it('BrandSchema rejects wrong type for agents.scout.max_tokens', () => {
    const brand = loadBrand();
    const tampered = JSON.parse(JSON.stringify(brand));
    tampered.agents.scout.max_tokens = 'lots';
    const res = BrandSchema.safeParse(tampered);
    expect(res.success).toBe(false);
  });

  it('BrandSchema rejects unknown enum value in voice.must_have_in_every_post', () => {
    const brand = loadBrand();
    const tampered = JSON.parse(JSON.stringify(brand));
    tampered.voice.must_have_in_every_post = ['bogus_value'];
    const res = BrandSchema.safeParse(tampered);
    expect(res.success).toBe(false);
  });

  it('BrandSchema accepts the loaded brand round-trip', () => {
    const brand = loadBrand();
    const res = BrandSchema.safeParse(brand);
    expect(res.success).toBe(true);
  });
});
