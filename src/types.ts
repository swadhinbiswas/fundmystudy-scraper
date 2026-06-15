/**
 * Shared types for the scraper bot.
 *
 * `RawListing` is what a source returns from `fetch()`. It's intentionally
 * permissive — sources have wildly different field names and quality. The
 * `Normalizer` (see normalizer.ts) maps these into `Opportunity`, the
 * canonical schema the API expects.
 */

export type FundingKind = 'full' | 'partial' | 'tuition' | 'living' | 'travel' | 'unknown';
export type DegreeLevel =
  | 'bachelor'
  | 'master'
  | 'phd'
  | 'postdoc'
  | 'diploma'
  | 'certificate'
  | 'any';
export type OpportunityStatus = 'pending' | 'approved' | 'rejected' | 'archived';

export interface RawListing {
  /** Source's own ID for this listing (required for dedupe) */
  externalId: string;
  /** Canonical URL — should be stable, not a session URL */
  url: string;
  title: string;
  provider: string;
  description?: string;

  /** Free-form field names. Normalizer maps to canonical field ids. */
  rawFields: string[];
  /** Country codes (ISO-3166-1 alpha-2) or free-form names. */
  rawCountries: string[];
  /** Degree levels this opportunity accepts. */
  rawDegreeLevels: string[];

  rawFundingKind: FundingKind;
  rawFundingAmount?: number;
  rawCurrency?: string;

  /** ISO 8601, or any string parseable by `new Date()`. */
  rawDeadline?: string;
  /** True if the source explicitly states IELTS/TOEFL is required. */
  rawIeltsRequired?: boolean;
  /** 4.0 scale. */
  rawGpaMin?: number;
}

export interface Opportunity {
  id?: string;
  externalId: string;
  source: string;
  title: string;
  provider: string;
  url: string;
  description?: string;

  type?: 'scholarship' | 'phd' | 'fellowship' | 'grant' | 'internship' | 'postdoc' | 'research';
  fields: string[];
  countries: string[];
  degreeLevels: DegreeLevel[];

  funding: {
    kind: FundingKind;
    amount?: number;
    currency?: string;
  };

  deadline?: string;
  ieltsRequired?: boolean;
  gpaMin?: number;

  status: OpportunityStatus;
  lastSeenAt: number;
  rawPayload?: string;
}

export interface SourceResult {
  source: string;
  fetched: number;
  normalized: number;
  submitted: number;
  skipped: number;
  errors: number;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
}
