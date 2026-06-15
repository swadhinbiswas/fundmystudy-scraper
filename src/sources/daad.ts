/**
 * DAAD Scholarship Database.
 *
 * DAAD ships its entire scholarship database as a 700KB JavaScript file:
 *   https://www.daad.de/bundles/daadstipendiendatenbanklsh/data/a/js/scholarships.js
 *
 * The file is `var scholarships = TAFFY([{...}, ...])` — a JSON array of
 * 164 scholarships with id, names, countries, subjects, etc.
 *
 * We extract: id, nameEn, programmnameEn, subjectGrps, isDaad, origin.
 * Country codes in `origin` are numeric IDs; we map the most common ones
 * to ISO-2 codes. The detail page URL is constructed from the ID.
 */
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const DATA_URL =
  'https://www.daad.de/bundles/daadstipendiendatenbanklsh/data/a/js/scholarships.js';
const DETAIL_BASE =
  'https://www.daad.de/en/study-and-research-in-germany/scholarships/';

// Subset of DAAD's numeric country code → ISO-2 mapping (full list is 270+).
// Source: DAAD Stipendiendatenbank country list.
const COUNTRY_CODES: Record<number, string> = {
  1: 'AF', 2: 'EG', 3: 'AL', 4: 'DZ', 5: 'AD', 6: 'AO', 7: 'AI', 8: 'AG', 9: 'GQ',
  10: 'AR', 11: 'AM', 12: 'AZ', 13: 'ET', 14: 'AU', 15: 'BS', 16: 'BH', 17: 'BD',
  18: 'BB', 19: 'BY', 20: 'BE', 21: 'BZ', 22: 'BJ', 23: 'BM', 24: 'BT', 25: 'BO',
  26: 'BA', 27: 'BW', 28: 'BR', 29: 'BN', 30: 'BG', 31: 'BF', 32: 'BI', 33: 'CL',
  34: 'CN', 35: 'CR', 36: 'CI', 37: 'CO', 38: 'KM', 39: 'CG', 40: 'HR', 41: 'CU',
  42: 'DK', 43: 'DE', 44: 'DM', 45: 'DO', 46: 'DJ', 47: 'EC', 48: 'SV', 49: 'ER',
  50: 'EE', 51: 'FJ', 52: 'FI', 53: 'FR', 54: 'PF', 55: 'GA', 56: 'GM', 57: 'GE',
  58: 'GH', 59: 'GD', 60: 'GR', 61: 'GT', 62: 'GN', 63: 'GW', 64: 'GY', 65: 'HT',
  66: 'HN', 67: 'IN', 68: 'ID', 69: 'IQ', 70: 'IR', 71: 'IE', 72: 'IS', 73: 'IL',
  74: 'IT', 75: 'JM', 76: 'JP', 77: 'YE', 78: 'JO', 79: 'KH', 80: 'CM', 81: 'CA',
  82: 'CV', 83: 'KZ', 84: 'KE', 85: 'KG', 86: 'KI', 87: 'KP', 88: 'KR', 89: 'XK',
  90: 'KW', 91: 'LA', 92: 'LS', 93: 'LB', 95: 'LY', 96: 'LI', 97: 'LU', 98: 'MG',
  99: 'MW', 100: 'MY', 101: 'MV', 102: 'ML', 103: 'MT', 104: 'MA', 105: 'MH',
  106: 'MR', 107: 'MU', 108: 'MX', 109: 'MC', 110: 'MN', 111: 'ME', 112: 'MZ',
  113: 'MM', 114: 'NA', 115: 'NP', 116: 'NZ', 117: 'NI', 118: 'NE', 119: 'NG',
  120: 'MK', 121: 'NO', 122: 'OM', 123: 'PK', 124: 'PA', 125: 'PG', 126: 'PY',
  127: 'PE', 128: 'PH', 129: 'PL', 130: 'PT', 131: 'QA', 132: 'RO', 133: 'RU',
  134: 'RW', 135: 'LC', 136: 'VC', 137: 'WS', 138: 'SM', 139: 'SA', 140: 'SN',
  141: 'RS', 142: 'SL', 143: 'SG', 144: 'SK', 145: 'SI', 146: 'SB', 147: 'SO',
  148: 'ZA', 149: 'SS', 150: 'ES', 151: 'LK', 152: 'KN', 153: 'PM', 154: 'SD',
  155: 'SR', 156: 'SZ', 157: 'SE', 158: 'CH', 159: 'SY', 160: 'TJ', 161: 'TW',
  162: 'TZ', 163: 'TH', 164: 'TG', 165: 'TO', 166: 'TT', 167: 'TN', 168: 'TR',
  169: 'TM', 170: 'TV', 171: 'UG', 172: 'UA', 173: 'GB', 174: 'US', 175: 'UY',
  176: 'UZ', 177: 'VU', 178: 'VA', 179: 'VE', 180: 'AE', 181: 'VN', 182: 'YE',
  183: 'ZM', 184: 'ZW', 185: 'PS', 186: 'HK', 187: 'CF', 188: 'CD', 189: 'CG',
  190: 'CG', 191: 'ST', 192: 'AW', 193: 'AZ', 194: 'BS', 195: 'VG', 196: 'KY',
  197: 'CK', 198: 'FO', 199: 'GL', 200: 'GI', 201: 'GU', 202: 'HT', 203: 'JE',
  204: 'IM', 205: 'KY', 206: 'MO', 207: 'NC', 208: 'NU', 209: 'NF', 210: 'PN',
  211: 'PR', 212: 'RE', 213: 'BL', 214: 'MF', 215: 'TC', 216: 'WF', 217: 'ZW',
  271: 'CW', 272: 'SX', 273: 'BQ', 274: 'XK',
};

// DAAD subject group letters → our field names
const SUBJECT_MAP: Record<string, string> = {
  A: 'Mathematics',
  B: 'Computer Science',
  C: 'Engineering',
  D: 'Medicine',
  E: 'Science',
  F: 'Law',
  G: 'Arts',
};

// DAAD programmtypId → our opportunity type
//   3 = study scholarships (bachelor/master)
//   5 = graduate scholarships (master/PhD)
//   7 = research grants and special programmes (PhD/postdoc/research)
const PROGRAMMTYPE_MAP: Record<number, 'scholarship' | 'research'> = {
  3: 'scholarship',
  5: 'scholarship',
  7: 'research',
};

interface DaadEntry {
  id: number;
  nameEn?: string;
  nameDe?: string;
  programmnameEn?: string;
  programmnameDe?: string;
  isDaad?: number;
  programmtypId?: number;
  subjectGrps?: string[];
  origin?: number[];
  intentions?: number[];
  status?: number[];
}

function extractDaadArray(js: string): DaadEntry[] {
  // File is: var scholarships = TAFFY([{...}, ...]);
  // Extract the [...] part.
  const m = js.match(/TAFFY\(\[([\s\S]+?)\]\)/);
  if (!m) return [];
  try {
    return JSON.parse(`[${m[1]}]`) as DaadEntry[];
  } catch {
    return [];
  }
}

export class DAADSource extends BaseSource {
  readonly name = 'daad';
  readonly displayName = 'DAAD';
  readonly schedule = '0 */12 * * *';
  readonly origin = 'https://www.daad.de';

  async fetch(): Promise<RawListing[]> {
    const js = await httpGet(DATA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const entries = extractDaadArray(js);
    logger.info({ count: entries.length }, 'daad: parsed');

    return entries
      .filter((e) => e.nameEn)
      .map((e) => {
        const countries = (e.origin ?? [])
          .map((c) => COUNTRY_CODES[c])
          .filter((c): c is string => Boolean(c));
        const fields = (e.subjectGrps ?? [])
          .map((g) => SUBJECT_MAP[g])
          .filter((f): f is string => Boolean(f));
        const oppType = (e.programmtypId !== undefined
          ? PROGRAMMTYPE_MAP[e.programmtypId]
          : 'scholarship') as 'scholarship' | 'research';
        // ProgrammtypId 3 = study (bachelor/master), 5 = graduate (master/PhD), 7 = research
        const isResearch = oppType === 'research';
        const degreeLevels: Array<'bachelor' | 'master' | 'phd' | 'postdoc'> = isResearch
          ? ['phd', 'postdoc']
          : e.programmtypId === 5
            ? ['master', 'phd']
            : ['bachelor', 'master'];
        return {
          externalId: `daad-${e.id}`,
          url: `${DETAIL_BASE}?id=${e.id}`,
          title: e.nameEn ?? e.nameDe ?? `DAAD #${e.id}`,
          provider: e.isDaad
            ? 'DAAD (German Academic Exchange Service)'
            : 'DAAD partner organisation',
          description:
            e.programmnameEn ?? e.programmnameDe ?? e.nameEn ?? '',
          rawFields: fields.length ? fields : ['all'],
          rawCountries: countries.length ? countries.slice(0, 10) : ['DE'],
          rawDegreeLevels: degreeLevels,
          rawFundingKind: isResearch ? ('full' as const) : ('partial' as const),
        };
      });
  }
}
