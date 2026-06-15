/**
 * In-process dedupe.
 *  - First pass: by (source, externalId) — exact match
 *  - Second pass: by url within same source
 *  - Third pass: by title + provider (lowercased, stripped of punctuation)
 *
 * In production this should be backed by the DB; the bot can ask the API
 * `GET /v1/admin/opportunities?source=daad` and use that as the seed set.
 */
import type { Opportunity } from './types.js';

function simplify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class Deduper {
  private byExtId = new Map<string, Opportunity>();
  private byUrl = new Map<string, Opportunity>();
  private byTitleProvider = new Map<string, Opportunity>();

  constructor(seed: Opportunity[] = []) {
    for (const o of seed) this.add(o);
  }

  private add(o: Opportunity) {
    this.byExtId.set(`${o.source}::${o.externalId}`, o);
    this.byUrl.set(`${o.source}::${o.url}`, o);
    this.byTitleProvider.set(`${o.source}::${simplify(o.title)}::${simplify(o.provider)}`, o);
  }

  /** Returns true if the opportunity is already known. */
  has(o: Opportunity): boolean {
    return (
      this.byExtId.has(`${o.source}::${o.externalId}`) ||
      this.byUrl.has(`${o.source}::${o.url}`) ||
      this.byTitleProvider.has(`${o.source}::${simplify(o.title)}::${simplify(o.provider)}`)
    );
  }

  /** Filter out duplicates. Returns the new (unique) opportunities in input order. */
  unique(list: Opportunity[]): Opportunity[] {
    const out: Opportunity[] = [];
    for (const o of list) {
      if (this.has(o)) continue;
      out.push(o);
      this.add(o);
    }
    return out;
  }

  static fromRemote(remote: Opportunity[]): Deduper {
    return new Deduper(remote);
  }
}
