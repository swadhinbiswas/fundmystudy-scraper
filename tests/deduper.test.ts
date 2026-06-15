import { describe, it, expect } from 'vitest';
import { Deduper } from '../src/deduper';
import type { Opportunity } from '../src/types';

const o = (over: Partial<Opportunity> = {}): Opportunity => {
  // Default URL + title are unique to the call so URL/title-based dedupe
  // doesn't bite unless the caller explicitly sets them.
  const externalId = over.externalId ?? Math.random().toString(36).slice(2);
  return {
    externalId,
    source: 'daad',
    title: `Scholarship ${externalId}`,
    provider: 'Test Provider',
    url: `https://x.com/${externalId}`,
    fields: [],
    countries: [],
    degreeLevels: ['any'],
    funding: { kind: 'unknown' },
    status: 'pending',
    lastSeenAt: 0,
    ...over,
  };
};

describe('Deduper', () => {
  it('treats (source, externalId) as the primary key', () => {
    const d = new Deduper([o({ externalId: 'a' })]);
    expect(d.has(o({ externalId: 'a', title: 'DIFFERENT' }))).toBe(true);
    expect(d.has(o({ externalId: 'b' }))).toBe(false);
  });

  it('dedupes by url within same source', () => {
    const d = new Deduper([o({ externalId: 'a', url: 'https://x.com/1' })]);
    expect(d.has(o({ externalId: 'b', url: 'https://x.com/1' }))).toBe(true);
  });

  it('does not dedupe across sources', () => {
    const d = new Deduper([o({ source: 'daad', externalId: 'a' })]);
    expect(d.has(o({ source: 'erasmus', externalId: 'a' }))).toBe(false);
  });

  it('dedupes by normalised title+provider', () => {
    const d = new Deduper([o({ externalId: 'a', title: 'Fulbright!', provider: 'US Gov.' })]);
    expect(d.has(o({ externalId: 'b', title: 'fulbright', provider: 'us gov' }))).toBe(true);
  });

  it('unique() returns new opportunities in input order', () => {
    const d = new Deduper([o({ externalId: 'a', url: 'https://x.com/a' })]);
    const result = d.unique([
      o({ externalId: 'a', url: 'https://x.com/a' }), // dup (seed)
      o({ externalId: 'b', url: 'https://x.com/b' }),
      o({ externalId: 'b', url: 'https://x.com/b' }), // dup (just added)
      o({ externalId: 'c', url: 'https://x.com/c' }),
    ]);
    expect(result.map((r) => r.externalId)).toEqual(['b', 'c']);
  });
});
