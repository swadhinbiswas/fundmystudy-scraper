/**
 * Erasmus Mundus Joint Master Degrees catalogue.
 *
 * Source: EACEA (European Education and Culture Executive Agency)
 *   https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en
 *
 * The catalogue is server-rendered (220 programmes). Each programme card
 * links to a detail page on:
 *   https://erasmus-plus.ec.europa.eu/projects/search/details/{PROJECT_ID}
 *
 * We parse: title, project URL, and infer the field from the title.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const CATALOGUE_URL =
  'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface ErasmusProgramme {
  externalId: string;
  title: string;
  url: string;
  field: string;
}

function inferField(title: string): string {
  const t = title.toLowerCase();
  if (/computer|software|data|ai|artificial|cyber/.test(t)) return 'Computer Science';
  if (/engineer|mechanical|electrical|transport|power|aeronaut/.test(t)) return 'Engineering';
  if (/math|statistic/.test(t)) return 'Mathematics';
  if (/physics|chemistry|biology|science|earth|renewable|energy|catalys/.test(t)) return 'Science';
  if (/medic|health|pharma|nurs/.test(t)) return 'Medicine';
  if (/law|legal|politic|security|peace/.test(t)) return 'Law';
  if (/business|management|economic|finance|journalism|media/.test(t)) return 'Business';
  if (/insect|sustainab|environment|agriculture|food|earth/.test(t)) return 'Science';
  if (/art|design|architect|cultural|heritage|language|linguist|multilingual|film/.test(t)) return 'Arts';
  if (/sport|ethic|education|psychology/.test(t)) return 'Social Sciences';
  return 'all';
}

function parseCatalogue(html: string): ErasmusProgramme[] {
  const $ = cheerio.load(html);
  const programmes: ErasmusProgramme[] = [];
  const seen = new Set<string>();

  // Two-pass parse:
  //   1. Index all title links by their parent card
  //   2. For each details link, find the nearest title link in the same card
  const titleByCard = new Map<string, string>();
  $('a[data-ecl-title-link]').each((_, el) => {
    const $t = $(el);
    const title =
      $t.find('span.ecl-link__label').first().text().trim() || $t.text().trim();
    if (!title) return;
    // Walk up to the card container
    const cardEl = $t.closest('article.ecl-content-item, div.ecl-content-item, .ecl-card');
    if (!cardEl.length) return;
    const key = (cardEl[0] as unknown as { _fms_key?: string })._fms_key ?? String(Math.random());
    (cardEl[0] as unknown as { _fms_key: string })._fms_key = key;
    titleByCard.set(key, title);
  });

  $('a[href*="/projects/search/details/"]').each((_, el) => {
    const $d = $(el);
    const href = $d.attr('href');
    if (!href) return;
    const idMatch = href.match(/\/details\/(\d+)/);
    const id = idMatch?.[1] ?? href;
    if (seen.has(id)) return;

    // Find the card this details link belongs to
    const cardEl = $d.closest('article.ecl-content-item, div.ecl-content-item, .ecl-card');
    const key = cardEl.length
      ? (cardEl[0] as unknown as { _fms_key?: string })._fms_key
      : undefined;
    const title = key ? titleByCard.get(key) : undefined;
    if (!title) return;

    seen.add(id);
    programmes.push({
      externalId: `emjmd-${id}`,
      title,
      url: href.startsWith('http') ? href : `https://erasmus-plus.ec.europa.eu${href}`,
      field: inferField(title),
    });
  });

  return programmes;
}

export class ErasmusSource extends BaseSource {
  readonly name = 'erasmus';
  readonly displayName = 'Erasmus Mundus';
  readonly schedule = '0 0 * * *';
  readonly origin = 'https://www.eacea.ec.europa.eu';

  async fetch(): Promise<RawListing[]> {
    const html = await httpGet(CATALOGUE_URL, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    });
    const programmes = parseCatalogue(html);
    logger.info({ count: programmes.length }, 'erasmus: parsed');

    return programmes.map((p) => ({
      externalId: p.externalId,
      url: p.url,
      title: p.title,
      provider: 'Erasmus+ (European Commission)',
      description: `Erasmus Mundus Joint Master — ${p.field}`,
      rawFields: [p.field],
      rawCountries: ['EU'],
      rawDegreeLevels: ['master'] as Array<'master'>,
      rawFundingKind: 'full' as const,
    }));
  }
}
