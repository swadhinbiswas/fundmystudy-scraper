/**
 * EURAXESS — the European Commission's researcher job portal.
 * Source: https://euraxess.ec.europa.eu/jobs/search
 *
 * Each job is rendered as <article class="ecl-content-item"> with:
 *   h3.ecl-content-block__title  →  title + job URL
 *   ul.ecl-content-block__primary-meta-container  →  organisation + posted date
 *   div.ecl-content-block__description  →  short description
 *   div.id-Work-Locations  →  "Number of offers: N, Country, City, ..."
 *   div.id-Research-Field  →  "Field » Subfield"
 *   div.id-Researcher-Profile  →  R1/R2/R3/R4
 *   div.id-Funding-Programme  →  EU programme name (or "Not funded by a EU programme")
 *   div.id-Application-Deadline  →  "31 Aug 2026 - 15:00 (Europe/Warsaw)"
 *
 * The site blocks generic UAs (returns a "Sorry" page); we must send a
 * real browser UA. We use a small cheerio pass instead of regex.
 */
import * as cheerio from 'cheerio';
import { BaseSource, type SourceContext } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import { normalize } from '../normalizer.js';
import type { Opportunity, RawListing } from '../types.js';

const SEARCH_URL =
  'https://euraxess.ec.europa.eu/jobs/search?keywords=phd&status=open&page=0';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface EuraxessJob {
  externalId: string;
  title: string;
  url: string;
  organisation: string;
  postedAt: string | null;
  description: string;
  country: string;
  city: string;
  field: string;
  researcherProfile: string;
  fundingProgramme: string;
  deadline: string | null;
}

function extractValue($article: cheerio.Cheerio<any>, label: string): string {
  const div = $article.find(`div.id-${label}`).first();
  if (!div.length) return '';
  // Text content, drop the icon SVG and the label, keep only the value.
  const text = div.text().replace(/\s+/g, ' ').trim();
  // Text is "Label: Value" — strip the label prefix.
  const colon = text.indexOf(':');
  return colon >= 0 ? text.slice(colon + 1).trim() : text;
}

function parseWorkLocation(value: string): { country: string; city: string } {
  // "Number of offers: 1, Poland, Kielce University of Technology, Kielce, 25-314, al. ..."
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  // parts[0] = "Number of offers: N"
  // parts[1] = country
  // parts[2] = org name OR city
  // parts[3] = city (if parts[2] is org) OR address
  let country = '';
  let city = '';
  if (parts.length >= 2) country = parts[1] ?? '';
  if (parts.length >= 4) city = parts[3] ?? '';
  else if (parts.length === 3) city = parts[2] ?? '';
  return { country, city };
}

function parseDeadline(value: string): string | null {
  // "31 Aug 2026 - 15:00 (Europe/Warsaw)" → "2026-08-31"
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

function parseEuraxessHtml(html: string): EuraxessJob[] {
  const $ = cheerio.load(html);
  const jobs: EuraxessJob[] = [];
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

    const url = href.startsWith('http') ? href : `https://euraxess.ec.europa.eu${href}`;
    const externalId = href.match(/\/jobs\/(\d+)/)?.[1] ?? href;

    jobs.push({
      externalId,
      title,
      url,
      organisation,
      postedAt,
      description,
      country,
      city,
      field,
      researcherProfile,
      fundingProgramme,
      deadline,
    });
  });
  return jobs;
}

export class EuraxessSource extends BaseSource {
  readonly name = 'euraxess';
  readonly displayName = 'EURAXESS (EU Researcher Jobs)';
  readonly schedule = '0 */6 * * *';
  readonly origin = 'https://euraxess.ec.europa.eu';

  /**
   * Override normalize: classify type by researcher profile.
   *   R1 (First Stage Researcher)  →  phd
   *   R2 (Recognised Researcher)   →  postdoc
   *   R3 (Established Researcher)  →  postdoc
   *   R4 (Leading Researcher)      →  postdoc
   * Default if unknown: research.
   */
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
    logger.info({ count: jobs.length }, 'euraxess: parsed');
    return jobs.map((j) => {
      const text = `${j.title} ${j.field} ${j.description}`.toLowerCase();
      const fields: string[] = [];
      if (/math|statistic/.test(text)) fields.push('Mathematics');
      if (/computer|software|ai|machine learning|data|cyber/.test(text)) fields.push('Computer Science');
      if (/engineer|mechanical|electrical|civil|chemical/.test(text)) fields.push('Engineering');
      if (/biology|chemistry|physics|science/.test(text)) fields.push('Science');
      if (/business|management|finance|economic/.test(text)) fields.push('Business');
      if (/medic|health|clinical|pharma/.test(text)) fields.push('Medicine');
      if (/law|legal|political/.test(text)) fields.push('Law');
      if (fields.length === 0) fields.push('all');

      const funding =
        /not funded/i.test(j.fundingProgramme) ? 'unknown' : 'full';

      return {
        externalId: j.externalId,
        url: j.url,
        title: j.title,
        provider: j.organisation,
        description: j.description.slice(0, 1500),
        rawFields: fields,
        rawCountries: [j.country || 'EU'],
        rawDegreeLevels: j.researcherProfile.match(/R1/i)
          ? ['phd']
          : ['phd', 'postdoc'],
        rawFundingKind: funding as 'full' | 'unknown',
        rawDeadline: j.deadline ?? undefined,
      };
    });
  }
}
