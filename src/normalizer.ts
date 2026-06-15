/**
 * Convert RawListing → Opportunity.
 *  - Maps free-form field names to the canonical set we use in the mobile app
 *  - Maps country names/codes to ISO-3166-1 alpha-2
 *  - Normalises degree levels
 *  - Parses messy date strings into ISO 8601
 *  - Detects "rolling" deadlines
 */
import type { DegreeLevel, FundingKind, Opportunity, RawListing } from './types.js';

const FIELD_ALIASES: Record<string, string> = {
  'computer science': 'Computer Science',
  cs: 'Computer Science',
  'software engineering': 'Computer Science',
  engineering: 'Engineering',
  'mechanical engineering': 'Engineering',
  'electrical engineering': 'Engineering',
  medicine: 'Medicine',
  medical: 'Medicine',
  nursing: 'Medicine',
  business: 'Business',
  'business administration': 'Business',
  mba: 'Business',
  finance: 'Business',
  law: 'Law',
  legal: 'Law',
  arts: 'Arts',
  'fine arts': 'Arts',
  'social science': 'Social Science',
  sociology: 'Social Science',
  psychology: 'Social Science',
  economics: 'Social Science',
  education: 'Education',
  teaching: 'Education',
  science: 'Natural Sciences',
  'natural sciences': 'Natural Sciences',
  physics: 'Natural Sciences',
  chemistry: 'Natural Sciences',
  biology: 'Natural Sciences',
  mathematics: 'Natural Sciences',
  all: 'all',
  any: 'all',
  '*': 'all',
};

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'united kingdom': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  ca: 'CA',
  canada: 'CA',
  de: 'DE',
  germany: 'DE',
  deutschland: 'DE',
  au: 'AU',
  australia: 'AU',
  jp: 'JP',
  japan: 'JP',
  kr: 'KR',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  nl: 'NL',
  netherlands: 'NL',
  holland: 'NL',
  se: 'SE',
  sweden: 'SE',
  sg: 'SG',
  singapore: 'SG',
  fr: 'FR',
  france: 'FR',
  ch: 'CH',
  switzerland: 'CH',
  fi: 'FI',
  finland: 'FI',
  in: 'IN',
  india: 'IN',
  cn: 'CN',
  china: 'CN',
  bd: 'BD',
  bangladesh: 'BD',
  ng: 'NG',
  nigeria: 'NG',
  ke: 'KE',
  kenya: 'KE',
  za: 'ZA',
  'south africa': 'ZA',
  br: 'BR',
  brazil: 'BR',
  mx: 'MX',
  mexico: 'MX',
  it: 'IT',
  italy: 'IT',
  es: 'ES',
  spain: 'ES',
  pt: 'PT',
  portugal: 'PT',
  no: 'NO',
  norway: 'NO',
  dk: 'DK',
  denmark: 'DK',
  be: 'BE',
  belgium: 'BE',
  at: 'AT',
  austria: 'AT',
  ie: 'IE',
  ireland: 'IE',
  nz: 'NZ',
  'new zealand': 'NZ',
  hk: 'HK',
  'hong kong': 'HK',
  tw: 'TW',
  taiwan: 'TW',
  eu: 'EU',
  europe: 'EU',
};

const DEGREE_ALIASES: Record<string, DegreeLevel> = {
  bachelor: 'bachelor',
  bachelors: 'bachelor',
  undergraduate: 'bachelor',
  'b.sc': 'bachelor',
  'b.a': 'bachelor',
  master: 'master',
  masters: 'master',
  'm.sc': 'master',
  'm.a': 'master',
  mba: 'master',
  graduate: 'master',
  phd: 'phd',
  doctoral: 'phd',
  doctorate: 'phd',
  'ph.d': 'phd',
  postdoc: 'postdoc',
  'post-doc': 'postdoc',
  postdoctoral: 'postdoc',
  diploma: 'diploma',
  certificate: 'certificate',
  any: 'any',
  all: 'any',
  '*': 'any',
};

const FUNDING_ALIASES: Record<string, FundingKind> = {
  full: 'full',
  fully: 'full',
  complete: 'full',
  'fully funded': 'full',
  '100%': 'full',
  partial: 'partial',
  partly: 'partial',
  'partial funding': 'partial',
  tuition: 'tuition',
  'tuition only': 'tuition',
  'fee waiver': 'tuition',
  living: 'living',
  'living stipend': 'living',
  stipend: 'living',
  'living allowance': 'living',
  travel: 'travel',
  'travel grant': 'travel',
};

function normKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function mapFields(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const k = normKey(r);
    if (FIELD_ALIASES[k]) out.add(FIELD_ALIASES[k]);
    else if (r.length > 0) out.add(r);
  }
  return Array.from(out);
}

function mapCountries(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    if (!r) continue;
    const k = normKey(r);
    if (COUNTRY_ALIASES[k]) out.add(COUNTRY_ALIASES[k]);
    else if (/^[A-Za-z]{2}$/.test(r)) out.add(r.toUpperCase());
    else if (/^[A-Za-z]{2,3}$/.test(r)) out.add(r.toUpperCase());
    else if (r.length >= 2) out.add(r);
  }
  return Array.from(out);
}

function mapDegreeLevels(raw: string[]): DegreeLevel[] {
  const out = new Set<DegreeLevel>();
  for (const r of raw) {
    const k = normKey(r);
    if (DEGREE_ALIASES[k]) out.add(DEGREE_ALIASES[k]);
  }
  if (out.size === 0) out.add('any');
  return Array.from(out);
}

function mapFundingKind(raw: string): FundingKind {
  const k = normKey(raw);
  return FUNDING_ALIASES[k] ?? 'unknown';
}

function parseDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (/rolling|ongoing|continuous|anytime/i.test(s)) return undefined;
  // Try DD/MM/YYYY or MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    const day = Number(a);
    const month = Number(b);
    if (day > 12 && month <= 12) {
      // DD/MM
      return new Date(Date.UTC(Number(y), month - 1, day)).toISOString();
    }
    if (month > 12 && day <= 12) {
      return new Date(Date.UTC(Number(y), day - 1, month)).toISOString();
    }
    return new Date(Date.UTC(Number(y), month - 1, day)).toISOString();
  }
  // Try "15 January 2026" / "January 15, 2026" / "15 Jan 2026"
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) {
    return native.toISOString();
  }
  return undefined;
}

export function normalize(raw: RawListing, ctx: { source: string; now: number }): Opportunity {
  const fields = mapFields(raw.rawFields);
  const countries = mapCountries(raw.rawCountries);
  const degreeLevels = mapDegreeLevels(raw.rawDegreeLevels);
  const fundingKind = mapFundingKind(String(raw.rawFundingKind ?? 'unknown'));
  const deadline = parseDate(raw.rawDeadline);

  return {
    externalId: raw.externalId,
    source: ctx.source,
    title: raw.title.trim().replace(/\s+/g, ' '),
    provider: raw.provider.trim().replace(/\s+/g, ' '),
    url: raw.url.trim(),
    description: raw.description?.trim(),
    fields,
    countries,
    degreeLevels,
    funding: {
      kind: fundingKind,
      amount: raw.rawFundingAmount,
      currency: raw.rawCurrency?.toUpperCase(),
    },
    deadline,
    ieltsRequired: raw.rawIeltsRequired,
    gpaMin: raw.rawGpaMin,
    status: 'pending',
    lastSeenAt: ctx.now,
    rawPayload: JSON.stringify(raw),
  };
}
