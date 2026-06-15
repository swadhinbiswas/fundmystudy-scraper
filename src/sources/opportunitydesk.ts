/**
 * Opportunity Desk — global scholarships, fellowships, short courses.
 * Source: https://opportunitydesk.org/
 * Uses RSS feed for reliable parsing.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const RSS_URL = 'https://opportunitydesk.org/feed/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function inferCountries(text: string): string[] {
  const t = text.toLowerCase();
  const c: string[] = [];
  if (/uk|united kingdom|britain/.test(t)) c.push('GB');
  if (/usa|united states|america|us\b/.test(t)) c.push('US');
  if (/australia/.test(t)) c.push('AU');
  if (/canada/.test(t)) c.push('CA');
  if (/germany|german/.test(t)) c.push('DE');
  if (/japan/.test(t)) c.push('JP');
  if (/china/.test(t)) c.push('CN');
  if (/europe|eu\b/.test(t)) c.push('EU');
  if (/singapore/.test(t)) c.push('SG');
  if (/new zealand/.test(t)) c.push('NZ');
  if (/sweden|netherlands|switzerland|france|italy|belgium|denmark|norway|finland|ireland/.test(t)) c.push('EU');
  if (/africa|kenya|nigeria|ghana|south africa|ethiopia|tanzania|uganda/.test(t)) c.push('AF');
  if (/india/.test(t)) c.push('IN');
  if (/brazil/.test(t)) c.push('BR');
  if (c.length === 0) c.push('global');
  return c;
}

function inferFields(text: string): string[] {
  const t = text.toLowerCase();
  if (/computer|software|data|ai|cyber/.test(t)) return ['Computer Science'];
  if (/engineer/.test(t)) return ['Engineering'];
  if (/medic|health|pharma/.test(t)) return ['Medicine'];
  if (/business|management|economic/.test(t)) return ['Business'];
  if (/law|legal/.test(t)) return ['Law'];
  if (/art|design|cultural/.test(t)) return ['Arts'];
  if (/education/.test(t)) return ['Education'];
  if (/environ|sustainab|climate/.test(t)) return ['Environmental Science'];
  return ['all'];
}

function inferDegreeLevels(text: string): string[] {
  const t = text.toLowerCase();
  if (/phd|doctoral/.test(t)) return ['phd'];
  if (/master|mba|postgraduate/.test(t)) return ['master'];
  if (/undergraduate|bachelor/.test(t)) return ['bachelor'];
  if (/fellowship|short.course|training/.test(t)) return ['master'];
  return ['master'];
}

export class OpportunityDeskSource extends BaseSource {
  readonly name = 'opportunitydesk';
  readonly displayName = 'Opportunity Desk';
  readonly schedule = '0 8 * * 1';
  readonly origin = 'https://opportunitydesk.org';

  async fetch(): Promise<RawListing[]> {
    const listings: RawListing[] = [];

    try {
      const xml = await httpGet(RSS_URL, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml' },
      });

      // Simple XML parsing without a full XML parser
      const items = xml.split('<item>').slice(1);
      for (const item of items) {
        const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
        const linkMatch = item.match(/<link[^>]*>(.*?)<\/link>/s);
        const descMatch = item.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);

        const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
        const link = linkMatch?.[1]?.trim() ?? '';
        const desc = descMatch?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 2000) ?? '';

        if (!title || !link) continue;

        const id = link.replace(/[^a-z0-9]/gi, '-').slice(0, 80);
        const fullText = `${title} ${desc}`;

        listings.push({
          externalId: `od-${id}`,
          url: link,
          title,
          provider: 'Opportunity Desk',
          description: desc || title,
          rawFields: inferFields(fullText),
          rawCountries: inferCountries(fullText),
          rawDegreeLevels: inferDegreeLevels(fullText) as any,
          rawFundingKind: /fully.funded|full.tuition|fully.funded/i.test(fullText) ? 'full' : 'partial',
          rawTags: ['scholarship', 'global', 'opportunitydesk'],
        });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'opportunitydesk: RSS fetch failed');
    }

    logger.info({ count: listings.length }, 'opportunitydesk: parsed');
    return listings;
  }
}
