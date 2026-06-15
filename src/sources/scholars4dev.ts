/**
 * Scholars4Dev — free scholarship listings for developing countries.
 * Source: https://scholars4dev.com/
 */
import * as cheerio from 'cheerio';
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const BASE = 'https://scholars4dev.com';
const LIST_URLS = [
  'https://scholars4dev.com/category/list-of-scholarships/',
  'https://scholars4dev.com/category/fully-funded-scholarships/',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function inferCountries(text: string): string[] {
  const t = text.toLowerCase();
  const countries: string[] = [];
  if (/uk|united kingdom|britain/.test(t)) countries.push('GB');
  if (/usa|united states|america|us\b/.test(t)) countries.push('US');
  if (/australia/.test(t)) countries.push('AU');
  if (/canada/.test(t)) countries.push('CA');
  if (/germany|german/.test(t)) countries.push('DE');
  if (/japan/.test(t)) countries.push('JP');
  if (/china/.test(t)) countries.push('CN');
  if (/europe|eu\b/.test(t)) countries.push('EU');
  if (/new zealand/.test(t)) countries.push('NZ');
  if (/singapore/.test(t)) countries.push('SG');
  if (/sweden/.test(t)) countries.push('SE');
  if (/netherlands/.test(t)) countries.push('NL');
  if (/switzerland/.test(t)) countries.push('CH');
  if (/france/.test(t)) countries.push('FR');
  if (/italy/.test(t)) countries.push('IT');
  if (/belgium/.test(t)) countries.push('BE');
  if (/denmark/.test(t)) countries.push('DK');
  if (/norway/.test(t)) countries.push('NO');
  if (/finland/.test(t)) countries.push('FI');
  if (/ireland/.test(t)) countries.push('IE');
  if (countries.length === 0) countries.push('global');
  return countries;
}

function inferFields(title: string, desc: string): string[] {
  const t = `${title} ${desc}`.toLowerCase();
  if (/computer|software|data|ai|artificial|cyber|tech/.test(t)) return ['Computer Science'];
  if (/engineer|mechanical|electrical|aeronaut|civil/.test(t)) return ['Engineering'];
  if (/math|statistic/.test(t)) return ['Mathematics'];
  if (/physics|chemistry|biology|earth|renewable|energy/.test(t)) return ['Natural Sciences'];
  if (/medic|health|pharma|nurs|public health/.test(t)) return ['Medicine'];
  if (/law|legal|politic/.test(t)) return ['Law'];
  if (/business|management|economic|finance/.test(t)) return ['Business'];
  if (/art|design|architect|cultural|language|film/.test(t)) return ['Arts'];
  if (/education|teach/.test(t)) return ['Education'];
  if (/environ|sustainab|agriculture|food/.test(t)) return ['Environmental Science'];
  return ['all'];
}

function inferDegreeLevels(text: string): string[] {
  const t = text.toLowerCase();
  const levels: string[] = [];
  if (/undergraduate|bachelor/.test(t)) levels.push('bachelor');
  if (/master|mba|postgraduate/.test(t)) levels.push('master');
  if (/phd|doctoral|doctorate/.test(t)) levels.push('phd');
  if (/postdoc|post-doctoral/.test(t)) levels.push('postdoc');
  if (levels.length === 0) levels.push('master');
  return levels;
}

export class Scholars4DevSource extends BaseSource {
  readonly name = 'scholars4dev';
  readonly displayName = 'Scholars4Dev';
  readonly schedule = '0 6 * * 1';
  readonly origin = BASE;

  async fetch(): Promise<RawListing[]> {
    const listings: RawListing[] = [];
    const seen = new Set<string>();

    for (const listUrl of LIST_URLS) {
      try {
        const html = await httpGet(listUrl, {
          headers: { 'User-Agent': UA, Accept: 'text/html' },
        });
        const $ = cheerio.load(html);

        $('article, .post, .entry').each((_, el) => {
          const $el = $(el);
          const titleEl = $el.find('h2 a, h3 a, .entry-title a').first();
          const title = titleEl.text().trim();
          const href = titleEl.attr('href') ?? '';
          if (!title || !href) return;

          const id = href.replace(/[^a-z0-9]/gi, '-').slice(0, 80);
          if (seen.has(id)) return;
          seen.add(id);

          const desc = $el.find('.entry-summary, .entry-content, p').first().text().trim().slice(0, 2000);
          const fullText = `${title} ${desc}`;

          listings.push({
            externalId: `s4d-${id}`,
            url: href.startsWith('http') ? href : `${BASE}${href}`,
            title,
            provider: 'Scholars4Dev',
            description: desc || title,
            rawFields: inferFields(title, desc),
            rawCountries: inferCountries(fullText),
            rawDegreeLevels: inferDegreeLevels(fullText) as any,
            rawFundingKind: /fully.funded|full.tuition|full.scholarship/i.test(fullText) ? 'full' : 'partial',
            rawTags: ['scholarship', 'developing-countries', 'scholars4dev'],
          });
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message, url: listUrl }, 'scholars4dev: fetch failed');
      }
    }

    logger.info({ count: listings.length }, 'scholars4dev: parsed');
    return listings;
  }
}
