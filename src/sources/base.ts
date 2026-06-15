/**
 * Base interface every source implements.
 *
 * Lifecycle:
 *   1. Runner calls `fetch()` → RawListing[] (one per scraped opportunity)
 *   2. Each RawListing is passed through `normalize()` → Opportunity
 *   3. Deduper filters out duplicates (already in DB)
 *   4. API client POSTs the rest to the worker
 *
 * Subclasses should override `fetch()`. They can override `normalize()` for
 * source-specific quirks; otherwise the default `normalize` in
 * `normalizer.ts` is used.
 */
import type { Opportunity, RawListing } from '../types.js';
import { get as httpGet } from '../http.js';
import { normalize } from '../normalizer.js';

export interface SourceContext {
  source: string;
  now: number;
  logger: {
    info: (o: unknown, m?: string) => void;
    warn: (o: unknown, m?: string) => void;
    error: (o: unknown, m?: string) => void;
  };
}

export abstract class BaseSource {
  /** Unique name. Used as the `source` field in DB and for logging. */
  abstract readonly name: string;
  /** Cron expression, e.g. "every 6 hours". */
  abstract readonly schedule: string;
  /** Default origin URL (for robots.txt / throttling). */
  abstract readonly origin: string;
  /** Optional: human-readable display name. */
  readonly displayName: string = '';

  /** Override only if the source needs custom logic. */
  async normalize(raw: RawListing, ctx: SourceContext): Promise<Opportunity> {
    return normalize(raw, ctx);
  }

  /** Validate a RawListing before normalization. Return null to skip. */
  validate(raw: RawListing): string | null {
    if (!raw.url || !raw.url.startsWith('http')) return 'invalid url';
    if (!raw.title || raw.title.length < 3) return 'title too short';
    if (!raw.externalId) return 'missing external_id';
    return null;
  }

  abstract fetch(): Promise<RawListing[]>;

  /** Optional hook: subclasses can call this.httpGet to inherit throttling. */
  protected async httpGet(url: string) {
    return httpGet(url, { headers: { Origin: this.origin, Referer: this.origin } });
  }
}
