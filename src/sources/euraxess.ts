/**
 * EURAXESS — the European Commission's researcher job portal.
 * Source: https://euraxess.ec.europa.eu/jobs/search
 *
 * Two-pass scraping:
 *   1. Parse search results for job list (title, org, country, deadline, etc.)
 *   2. Visit each detail page for full description, requirements, logo
 *
 * Detail page has structured sections:
 *   - Offer Description (full text)
 *   - Requirements (full text)
 *   - Description list: Organisation, Department, Research Field, etc.
 *   - Organisation logo in header
 */
import * as cheerio from 'cheerio';
import { BaseSource, type SourceContext } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import { normalize } from '../normalizer.js';
import type { Opportunity, RawListing } from '../types.js';

const SEARCH_URL =
  'https://euraxess.ec.europa.eu/jobs/search?keywords=phd&status=open&page=0';
const DETAIL_BASE = 'https://euraxess.ec.europa.eu';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function extractValue($article: cheerio.Cheerio<any>, label: string): string {
  const div = $article.find(`div.id-${label}`).first();
  if (!div.length) return '';
  const text = div.text().replace(/\s+/g, ' ').trim();
  const colon = text.indexOf(':');
  return colon >= 0 ? text.slice(colon + 1).trim() : text;
}

function parseWorkLocation(value: string): { country: string; city: string } {
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  let country = '';
  let city = '';
  if (parts.length >= 2) country = parts[1] ?? '';
  if (parts.length >= 4) city = parts[3] ?? '';
  else if (parts.length === 3) city = parts[2] ?? '';
  return { country, city };
}

function parseDeadline(value: string): string | null {
  const m = value.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (!m) return null;
  const day = (m[1] ?? '1').padStart(2, '0');
  const monthStr = (m[2] ?? '').slice(0, 3).toLowerCase();
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month = months[monthStr];
  if (!month) return null;
  return `${m[3] ?? new Date().getFullYear()}-${month}-${day}`;
}

function parseEuraxessHtml(html: string): { externalId: string; title: string; url: string; organisation: string; postedAt: string | null; description: string; country: string; city: string; field: string; researcherProfile: string; fundingProgramme: string; deadline: string | null; logoUrl: string }[] {
  const $ = cheerio.load(html);
  const jobs: { externalId: string; title: string; url: string; organisation: string; postedAt: string | null; description: string; country: string; city: string; field: string; researcherProfile: string; fundingProgramme: string; deadline: string | null; logoUrl: string }[] = [];
  $('article.ecl-content-item').each((_, el) => {
    const $a = $(el);
    const $title = $a.find('h3.ecl-content-block__title a').first();
    const href = $title.attr('href') ?? '';
    if (!href || !/\/jobs\/\d+/.test(href)) return;
    const title = $title.find('span').first().text().trim() || $title.text().trim();
    if (!title) return;

    const orgAnchor = $a.find('ul.ecl-content-block__primary-meta-container a').first();
    const organisation = orgAnchor.text().trim() || 'Unknown';
    const postedLi = $a.find('ul.ecl-content-block__primary-meta-container li').eq(1).text().trim();
    const postedAt = /Posted on:\s*(.+)/i.exec(postedLi)?.[1]?.trim() ?? null;
    const description =
      $a.find('div.ecl-content-block__description').first().text().replace(/\s+/g, ' ').trim();

    const workValue = extractValue($a, 'Work-Locations');
    const { country, city } = parseWorkLocation(workValue);
    const field = extractValue($a, 'Research-Field');
    const researcherProfile = extractValue($a, 'Researcher-Profile');
    const fundingProgramme = extractValue($a, 'Funding-Programme');
    const deadline = parseDeadline(extractValue($a, 'Application-Deadline'));

    const url = href.startsWith('http') ? href : `${DETAIL_BASE}${href}`;
    const externalId = href.match(/\/jobs\/(\d+)/)?.[1] ?? href;

    jobs.push({
      externalId, title, url, organisation, postedAt, description,
      country, city, field, researcherProfile, fundingProgramme, deadline, logoUrl: '',
    });
  });
  return jobs;
}

/**
 * Visit a EURAXESS detail page and extract structured data:
 *   - Full offer description
 *   - Requirements
 *   - Organisation logo
 *   - Website URL
 */
async function scrapeDetailPage(url: string): Promise<{
  fullDescription: string;
  requirements: string[];
  logoUrl: string;
  websiteUrl: string;
}> {
  try {
    const html = await httpGet(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const $ = cheerio.load(html);

    // Full offer description
    const descHeading = $('h2').filter((_, el) => /offer description/i.test($(el).text()));
    let fullDescription = '';
    if (descHeading.length) {
      // Get content until next h2
      let next = descHeading.next();
      while (next.length && !next.is('h2')) {
        const text = next.text().replace(/\s+/g, ' ').trim();
        if (text) fullDescription += text + '\n\n';
        next = next.next();
      }
    }
    if (!fullDescription) {
      // Fallback: meta description
      fullDescription = $('meta[name="description"]').attr('content') ?? '';
    }

    // Requirements section
    const reqHeading = $('h2').filter((_, el) => /requirement/i.test($(el).text()));
    const requirements: string[] = [];
    if (reqHeading.length) {
      let next = reqHeading.next();
      while (next.length && !next.is('h2')) {
        // Check for list items
        next.find('li').each((_, li) => {
          const t = $(li).text().replace(/\s+/g, ' ').trim();
          if (t) requirements.push(t);
        });
        // If no list items, grab paragraph text
        if (!next.find('li').length) {
          const text = next.text().replace(/\s+/g, ' ').trim();
          if (text && text.length > 10) requirements.push(text);
        }
        next = next.next();
      }
    }

    // Logo — EURAXESS shows org logo in the page header
    let logoUrl = '';
    const logoImg = $('img.ecl-content-item__media-container__image, img[class*="logo"], .ecl-site-header__logo img').first();
    if (logoImg.length) {
      logoUrl = logoImg.attr('src') ?? '';
      if (logoUrl && !logoUrl.startsWith('http')) {
        logoUrl = `${DETAIL_BASE}${logoUrl}`;
      }
    }

    // Website URL from description list
    let websiteUrl = '';
    $('dt').each((_, dt) => {
      if (/website/i.test($(dt).text())) {
        const dd = $(dt).next('dd');
        const a = dd.find('a').first();
        websiteUrl = a.attr('href') ?? dd.text().trim();
      }
    });

    return { fullDescription: fullDescription.trim(), requirements, logoUrl, websiteUrl };
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'euraxess detail scrape failed');
    return { fullDescription: '', requirements: [], logoUrl: '', websiteUrl: '' };
  }
}

export class EuraxessSource extends BaseSource {
  readonly name = 'euraxess';
  readonly displayName = 'EURAXESS (EU Researcher Jobs)';
  readonly schedule = '0 */6 * * *';
  readonly origin = 'https://euraxess.ec.europa.eu';

  override async normalize(raw: RawListing, ctx: SourceContext): Promise<Opportunity> {
    const opp = await normalize(raw, ctx);
    const title = raw.title.toLowerCase();
    if (/r1\b|first stage|phd|doctoral/.test(`${title} ${raw.description ?? ''}`)) {
      opp.type = 'phd';
    } else if (/r2|recognised|post-?doc|postdoc/.test(`${title} ${raw.description ?? ''}`)) {
      opp.type = 'postdoc';
    } else if (/lecturer|professor|assistant professor/.test(title)) {
      opp.type = 'research';
    } else {
      opp.type = 'research';
    }
    return opp;
  }

  async fetch(): Promise<RawListing[]> {
    const html = await httpGet(SEARCH_URL, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const jobs = parseEuraxessHtml(html);
    logger.info({ count: jobs.length }, 'euraxess: parsed list');

    // Visit detail pages for full data (max 20 to avoid rate limits)
    const detailed: RawListing[] = [];
    const toScrape = jobs.slice(0, 20);

    for (const j of toScrape) {
      const detail = await scrapeDetailPage(j.url);

      const text = `${j.title} ${j.field} ${j.description} ${detail.fullDescription}`.toLowerCase();
      const fields: string[] = [];
      if (/math|statistic/.test(text)) fields.push('Mathematics');
      if (/computer|software|ai|machine learning|data|cyber/.test(text)) fields.push('Computer Science');
      if (/engineer|mechanical|electrical|civil|chemical/.test(text)) fields.push('Engineering');
      if (/biology|chemistry|physics|science/.test(text)) fields.push('Science');
      if (/business|management|finance|economic/.test(text)) fields.push('Business');
      if (/medic|health|clinical|pharma/.test(text)) fields.push('Medicine');
      if (/law|legal|political/.test(text)) fields.push('Law');
      if (/education|teaching|pedagog/.test(text)) fields.push('Education');
      if (fields.length === 0) fields.push('all');

      const funding =
        /not funded/i.test(j.fundingProgramme) ? 'unknown' : 'full';

      // Build rich description from search + detail
      const parts = [j.description];
      if (detail.fullDescription) parts.push(detail.fullDescription);
      if (detail.websiteUrl) parts.push(`Apply at: ${detail.websiteUrl}`);

      detailed.push({
        externalId: j.externalId,
        url: detail.websiteUrl || j.url,
        title: j.title,
        provider: j.organisation,
        description: parts.join('\n\n').slice(0, 3000),
        rawFields: fields,
        rawCountries: [j.country || 'EU'],
        rawDegreeLevels: j.researcherProfile.match(/R1/i)
          ? ['phd']
          : ['phd', 'postdoc'],
        rawFundingKind: funding as 'full' | 'unknown',
        rawDeadline: j.deadline ?? undefined,
        rawRequirements: detail.requirements,
        rawTags: [j.field, j.fundingProgramme].filter(
          (t) => t && !/not funded/i.test(t),
        ),
        rawLogoUrl: detail.logoUrl || undefined,
      });

      // Small delay between detail page fetches
      if (toScrape.indexOf(j) < toScrape.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    logger.info({ count: detailed.length }, 'euraxess: detailed scrape done');
    return detailed;
  }
}
