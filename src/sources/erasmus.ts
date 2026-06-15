/**
 * Erasmus Mundus Joint Master Degrees catalogue.
 *
 * Source: EACEA (European Education and Culture Executive Agency)
 *   https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en
 *
 * Two-pass scraping:
 *   1. Parse catalogue for programme list
 *   2. Visit each detail page for full description, requirements, eligibility
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
  programmeUrl: string;
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

  // Each card has: a[data-ecl-title-link] with programme URL + title, and a[href*="/projects/search/details/"] with project ID
  $('article.ecl-card').each((_, card) => {
    const $card = $(card);
    const titleLink = $card.find('a[data-ecl-title-link]').first();
    const programmeUrl = titleLink.attr('href') ?? '';
    const title = titleLink.find('span.ecl-link__label').first().text().trim() || titleLink.text().trim();
    if (!title) return;

    const projectLink = $card.find('a[href*="/projects/search/details/"]').first();
    const projectHref = projectLink.attr('href') ?? '';
    const idMatch = projectHref.match(/\/details\/(\d+)/);
    const id = idMatch?.[1] ?? programmeUrl;
    if (seen.has(id)) return;
    seen.add(id);

    programmes.push({
      externalId: `emjmd-${id}`,
      title,
      programmeUrl,
      field: inferField(title),
    });
  });

  return programmes;
}

/**
 * Visit an Erasmus+ detail page and extract structured data.
 */
async function scrapeDetailPage(url: string): Promise<{
  fullDescription: string;
  eligibility: string[];
  requirements: string[];
  benefits: string[];
  logoUrl: string;
  consortium: string;
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

    // Full description — the main content area
    let fullDescription = '';
    const mainContent = $('main, .project-content, article, .content-area').first();
    if (mainContent.length) {
      mainContent.find('p, li, h2, h3').each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!text) return;
        if (tag === 'h2' || tag === 'h3') {
          fullDescription += `\n## ${text}\n`;
        } else if (tag === 'li') {
          fullDescription += `- ${text}\n`;
        } else {
          fullDescription += `${text}\n\n`;
        }
      });
    }
    if (!fullDescription) {
      fullDescription = $('meta[name="description"]').attr('content') ?? '';
    }

    // Look for specific sections
    const eligibility: string[] = [];
    const requirements: string[] = [];
    const benefits: string[] = [];

    $('h2, h3').each((_, heading) => {
      const headingText = $(heading).text().toLowerCase();
      let section = '';
      if (/eligib|who can|admission/.test(headingText)) section = 'eligibility';
      else if (/requirement|entry|prerequisite/.test(headingText)) section = 'requirements';
      else if (/benefit|what.*offer|scholarship.*include|funding/.test(headingText)) section = 'benefits';

      if (section) {
        let next = $(heading).next();
        while (next.length && !next.is('h2, h3')) {
          next.find('li').each((_, li) => {
            const t = $(li).text().replace(/\s+/g, ' ').trim();
            if (t) {
              if (section === 'eligibility') eligibility.push(t);
              else if (section === 'requirements') requirements.push(t);
              else if (section === 'benefits') benefits.push(t);
            }
          });
          if (!next.find('li').length) {
            const text = next.text().replace(/\s+/g, ' ').trim();
            if (text && text.length > 10) {
              if (section === 'eligibility') eligibility.push(text);
              else if (section === 'requirements') requirements.push(text);
              else if (section === 'benefits') benefits.push(text);
            }
          }
          next = next.next();
        }
      }
    });

    // Logo
    let logoUrl = '';
    const logoImg = $('img[alt*="logo"], img[class*="logo"], .ecl-site-header__logo img, header img').first();
    if (logoImg.length) {
      logoUrl = logoImg.attr('src') ?? '';
      if (logoUrl && !logoUrl.startsWith('http')) {
        logoUrl = new URL(logoUrl, url).href;
      }
    }

    // Consortium info
    let consortium = '';
    $('dt, th').each((_, dt) => {
      if (/consortium|coordinator|partner/i.test($(dt).text())) {
        consortium = $(dt).next('dd, td').text().replace(/\s+/g, ' ').trim();
      }
    });

    return { fullDescription: fullDescription.trim(), eligibility, requirements, benefits, logoUrl, consortium };
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'erasmus detail scrape failed');
    return { fullDescription: '', eligibility: [], requirements: [], benefits: [], logoUrl: '', consortium: '' };
  }
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
    logger.info({ count: programmes.length }, 'erasmus: parsed list');

    // Visit detail pages for full data (max 20)
    const detailed: RawListing[] = [];
    const toScrape = programmes.slice(0, 5);

    for (let i = 0; i < toScrape.length; i++) {
      const p = toScrape[i];
      let detail = { fullDescription: '', eligibility: [] as string[], requirements: [] as string[], benefits: [] as string[], logoUrl: '', consortium: '' };

      // Visit the programme's own website for rich content
      if (p.programmeUrl && p.programmeUrl.startsWith('http')) {
        detail = await scrapeDetailPage(p.programmeUrl);
      }

      const parts = [`Erasmus Mundus Joint Master in ${p.field}`];
      if (detail.fullDescription) parts.push(detail.fullDescription);
      if (detail.consortium) parts.push(`Consortium: ${detail.consortium}`);

      detailed.push({
        externalId: p.externalId,
        url: p.programmeUrl,
        title: p.title,
        provider: 'Erasmus+ (European Commission)',
        description: parts.join('\n\n').slice(0, 3000),
        rawFields: [p.field],
        rawCountries: ['EU'],
        rawDegreeLevels: ['master'] as Array<'master'>,
        rawFundingKind: 'full' as const,
        rawEligibility: detail.eligibility,
        rawRequirements: detail.requirements,
        rawBenefits: detail.benefits,
        rawTags: [p.field, 'erasmus', 'master', 'europe'],
        rawLogoUrl: detail.logoUrl || undefined,
      });

      // Delay between fetches
      if (i < toScrape.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    logger.info({ count: detailed.length }, 'erasmus: detailed scrape done');
    return detailed;
  }
}
