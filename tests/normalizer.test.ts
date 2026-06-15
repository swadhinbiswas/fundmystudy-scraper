import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalizer';
import type { RawListing } from '../src/types';

const baseRaw: RawListing = {
  externalId: 'foo-123',
  url: 'https://example.com/scholarship',
  title: '  Test   Scholarship  ',
  provider: '  Test Provider  ',
  description: '  description  ',
  rawFields: ['Computer Science', 'cs', 'engineering', 'random-field'],
  rawCountries: ['US', 'USA', 'United Kingdom', 'XX'],
  rawDegreeLevels: ['master', 'Master', 'bachelor'],
  rawFundingKind: 'fully funded' as never,
  rawFundingAmount: 50000,
  rawCurrency: 'usd',
  rawDeadline: '2026-12-15',
  rawIeltsRequired: true,
  rawGpaMin: 3.5,
};

describe('normalize', () => {
  it('trims whitespace, dedupes field aliases, and lowercases to canonical', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.title).toBe('Test Scholarship');
    expect(o.provider).toBe('Test Provider');
    expect(o.description).toBe('description');
    expect(o.fields).toEqual(
      expect.arrayContaining(['Computer Science', 'Engineering', 'random-field']),
    );
    expect(o.fields.length).toBe(3);
  });

  it('maps country aliases to ISO-3166 alpha-2', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.countries).toEqual(expect.arrayContaining(['US', 'GB', 'XX']));
  });

  it('maps degree level aliases and dedupes', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.degreeLevels).toEqual(expect.arrayContaining(['master', 'bachelor']));
    expect(o.degreeLevels.length).toBe(2);
  });

  it('maps funding kind aliases', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.funding.kind).toBe('full');
    expect(o.funding.currency).toBe('USD');
  });

  it('parses ISO 8601 deadline', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.deadline).toBe('2026-12-15T00:00:00.000Z');
  });

  it('parses DD/MM/YYYY deadline', () => {
    const o = normalize({ ...baseRaw, rawDeadline: '15/12/2026' }, { source: 'test', now: 0 });
    expect(o.deadline).toBe('2026-12-15T00:00:00.000Z');
  });

  it('parses MM/DD/YYYY deadline when month > 12 (impossible DD)', () => {
    const o = normalize({ ...baseRaw, rawDeadline: '12/15/2026' }, { source: 'test', now: 0 });
    expect(o.deadline).toBe('2026-12-15T00:00:00.000Z');
  });

  it('returns undefined for "rolling" deadlines', () => {
    const o = normalize({ ...baseRaw, rawDeadline: 'rolling' }, { source: 'test', now: 0 });
    expect(o.deadline).toBeUndefined();
  });

  it('returns undefined deadline for unparseable strings', () => {
    const o = normalize({ ...baseRaw, rawDeadline: 'next quarter' }, { source: 'test', now: 0 });
    expect(o.deadline).toBeUndefined();
  });

  it('preserves optional fields when present', () => {
    const o = normalize(baseRaw, { source: 'test', now: 0 });
    expect(o.ieltsRequired).toBe(true);
    expect(o.gpaMin).toBe(3.5);
  });

  it('sets status=pending by default and embeds raw payload', () => {
    const o = normalize(baseRaw, { source: 'daad', now: 42 });
    expect(o.status).toBe('pending');
    expect(o.lastSeenAt).toBe(42);
    expect(o.source).toBe('daad');
    expect(o.rawPayload).toBeDefined();
    const parsed = JSON.parse(o.rawPayload!);
    expect(parsed.externalId).toBe('foo-123');
  });
});
