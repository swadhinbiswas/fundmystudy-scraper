/**
 * jobs.ac.uk — UK academic jobs board.
 *
 * Source: https://www.jobs.ac.uk/search/?Keywords=phd
 *
 * The public RSS feeds (e.g. /feeds/phd.xml) were removed in 2024.
 * The search results page is server-rendered with real job links like:
 *   /job/DRX260/programme-manager-lifelong-engagement-atlantic-fellows-...
 *
 * We scrape the search results page, which returns ~20 jobs per page.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const SEARCH_QUERIES = [
  'https://www.jobs.ac.uk/search/?Keywords=phd',
  'https://www.jobs.ac.uk/search/?Keywords=research',
  'https://www.jobs.ac.uk/search/?Keywords=studentship',
];

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface JobsAcListing {
  externalId: string;
  title: string;
  url: string;
  org: string;
}

function parseSearchPage(html: string): JobsAcListing[] {
  const $ = cheerio.load(html);
  const listings: JobsAcListing[] = [];
  const seen = new Set<string>();

  $('a[href*="/job/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');
    if (!href) return;
    // Only individual job pages, not search result pagination
    if (!/\/job\/[A-Z0-9]+\/[a-z0-9-]+/i.test(href)) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title = $a.text().trim();
    if (!title || title.length < 5) return;

    // Extract org from the URL slug (last segment, title-cased)
    const slug = href.split('/').pop() ?? '';
    const orgSlug = slug.replace(/-/g, ' ');
    const org = orgSlug
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const idMatch = href.match(/\/job\/([A-Z0-9]+)/i);
    const id = idMatch?.[1] ?? href;

    listings.push({
      externalId: `jobsac-${id}`,
      title,
      url: href.startsWith('http') ? href : `https://www.jobs.ac.uk${href}`,
      org: org.slice(0, 200),
    });
  });

  return listings;
}

export class JobsAcUkSource extends BaseSource {
  readonly name = 'jobs-ac-uk';
  readonly displayName = 'jobs.ac.uk (UK Academic Jobs)';
  readonly schedule = '0 */6 * * *';
  readonly origin = 'https://www.jobs.ac.uk';

  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<string>();

    for (const url of SEARCH_QUERIES) {
      try {
        const html = await httpGet(url, {
          headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
        });
        const listings = parseSearchPage(html);
        logger.info({ url, count: listings.length }, 'jobs.ac.uk: parsed');
        for (const l of listings) {
          if (seen.has(l.externalId)) continue;
          seen.add(l.externalId);
          const text = `${l.title} ${l.org}`.toLowerCase();
          const fields: string[] = [];
          if (/computer|software|data|ai/.test(text)) fields.push('Computer Science');
          if (/engineer|mechanical|electrical/.test(text)) fields.push('Engineering');
          if (/biology|chemistry|physics/.test(text)) fields.push('Science');
          if (/business|management|finance/.test(text)) fields.push('Business');
          if (/medic|health|nurs|pharma/.test(text)) fields.push('Medicine');
          if (/math|statistic/.test(text)) fields.push('Mathematics');
          if (fields.length === 0) fields.push('all');

          const funding = /fully[\s-]?funded|stipend/.test(text)
            ? 'full'
            : /funded/.test(text)
              ? 'partial'
              : 'unknown';

          const kind = /phd|doctoral|studentship/.test(text) ? 'phd' : 'research';

          out.push({
            externalId: l.externalId,
            url: l.url,
            title: l.title,
            provider: l.org,
            description: `${l.org} — ${l.title}`,
            rawFields: fields,
            rawCountries: ['GB'],
            rawDegreeLevels: kind === 'phd' ? ['phd'] : ['phd', 'postdoc', 'research'],
            rawFundingKind: funding as 'full' | 'partial' | 'unknown',
          });
        }
      } catch (e) {
        logger.warn(
          { err: (e as Error).message, url },
          'jobs.ac.uk search failed',
        );
      }
    }

    return out;
  }
}
