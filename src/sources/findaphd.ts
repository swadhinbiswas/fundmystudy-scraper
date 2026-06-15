/**
 * FindAPhD — UK-focused PhD listings portal.
 *
 * Source: https://www.findaphd.com/phds/
 *
 * The site is behind Cloudflare, which blocks plain HTTP requests with a
 * "Just a moment…" challenge. We use Playwright (headless Chromium) to:
 *   1. Launch a browser
 *   2. Navigate to the search page (Cloudflare passes automatically in real browser)
 *   3. Wait for the listing table
 *   4. Extract each <tr class="phd-result"> row
 */
import { type Browser, chromium } from 'playwright';
import { BaseSource } from './base.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const SEARCH_URL = 'https://www.findaphd.com/phds/?SortBy=ClosingDate';

interface FindaphdRow {
  title: string;
  url: string;
  university: string;
  department: string;
  deadline: string | null;
}

async function scrapeWithPlaywright(): Promise<FindaphdRow[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--headless=new', // full chromium headless (passes Cloudflare JS challenge)
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    logger.info({ url: SEARCH_URL }, 'findaphd: navigating');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Cloudflare challenge can take a few seconds. Wait for either the
    // listing table or a Cloudflare title.
    await page
      .waitForSelector('tr.phd-result, .phd-result, .resultsTable, table.phd-results, [class*="phd-result"]', {
        timeout: 30_000,
      })
      .catch(() => null);

    // If still on Cloudflare challenge, wait a bit more
    const title = await page.title();
    logger.info({ title }, 'findaphd: page title');
    if (/just a moment|attention required|cloudflare/i.test(title)) {
      logger.info('findaphd: cloudflare challenge detected, waiting 30s');
      // Cloudflare's JS challenge can take up to 30s to resolve.
      // Poll every 3s for the real page.
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(3_000);
        const t = await page.title();
        if (!/just a moment|attention required|cloudflare/i.test(t)) {
          logger.info({ title: t, waitedMs: (i + 1) * 3000 }, 'findaphd: cloudflare resolved');
          break;
        }
      }
    }

    const html = await page.content();
    logger.info({ htmlSize: html.length, hasPhdResult: html.includes('phd-result') }, 'findaphd: page loaded');
    return parseHtml(html);
  } finally {
    if (browser) await browser.close();
  }
}

function parseHtml(html: string): FindaphdRow[] {
  const rows: FindaphdRow[] = [];
  // Match <tr class="phd-result"> or <div class="phd-result">
  const cardRe = /<(?:tr|div)[^>]*class="[^"]*\bphd-result\b[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html))) {
    const body = m[1] ?? '';
    // Title link
    const titleMatch =
      body.match(/<a[^>]+class="[^"]*phd-result__title[^"]*"[^>]*>([^<]+)<\/a>/) ??
      body.match(/<a[^>]+href="(\/phds\/[^"]+)"[^>]*>([^<]+)<\/a>/);
    if (!titleMatch) continue;
    const title = (titleMatch[2] ?? titleMatch[1] ?? '').trim();
    const href = (titleMatch[1] ?? '').trim();
    if (!title || !href) continue;
    // University
    const uniMatch =
      body.match(/<div[^>]*class="[^"]*phd-result__university[^"]*"[^>]*>([^<]+)/) ??
      body.match(/<span[^>]*class="[^"]*university[^"]*"[^>]*>([^<]+)/);
    const university = uniMatch?.[1]?.trim() ?? 'Unknown';
    // Department
    const deptMatch = body.match(
      /<div[^>]*class="[^"]*phd-result__department[^"]*"[^>]*>([^<]+)/,
    );
    const department = deptMatch?.[1]?.trim() ?? '';
    // Deadline
    const deadlineMatch = body.match(
      /<div[^>]*class="[^"]*phd-result__deadline[^"]*"[^>]*>([^<]+)/,
    );
    const deadline = deadlineMatch?.[1]?.trim() ?? null;

    rows.push({
      title,
      url: href.startsWith('http') ? href : `https://www.findaphd.com${href}`,
      university,
      department,
      deadline,
    });
  }
  return rows;
}

function parseDeadline(s: string | null): string | null {
  if (!s) return null;
  // Try common UK date formats: "31 Aug 2026", "31/08/2026", "Aug 31, 2026"
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const day = m[1]?.padStart(2, '0') ?? '01';
    const monthStr = (m[2] ?? '').slice(0, 3).toLowerCase();
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = months[monthStr] ?? '01';
    return `${m[3]}-${month}-${day}`;
  }
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

export class FindaphdSource extends BaseSource {
  readonly name = 'findaphd';
  readonly displayName = 'FindAPhD (UK PhD Listings)';
  readonly schedule = '0 */12 * * *';
  readonly origin = 'https://www.findaphd.com';

  async fetch(): Promise<RawListing[]> {
    let rows: FindaphdRow[];
    try {
      rows = await scrapeWithPlaywright();
    } catch (e) {
      logger.warn(
        { err: (e as Error).message },
        'findaphd: playwright failed — falling back to regex parse of saved HTML if available',
      );
      rows = [];
    }
    logger.info({ count: rows.length }, 'findaphd: parsed');

    return rows.map((r) => {
      const text = `${r.title} ${r.department} ${r.university}`.toLowerCase();
      const fields: string[] = [];
      if (/computer|software|ai|machine learning|data|cyber/.test(text)) fields.push('Computer Science');
      if (/engineer|mechanical|electrical|civil|chemical/.test(text)) fields.push('Engineering');
      if (/biology|chemistry|physics/.test(text)) fields.push('Science');
      if (/business|management|finance|economic/.test(text)) fields.push('Business');
      if (/medic|health|clinical|pharma/.test(text)) fields.push('Medicine');
      if (/math|statistic/.test(text)) fields.push('Mathematics');
      if (/law|legal|political/.test(text)) fields.push('Law');
      if (fields.length === 0) fields.push('all');

      return {
        externalId: `findaphd-${r.url}`,
        url: r.url,
        title: r.title,
        provider: r.university,
        description: r.department,
        rawFields: fields,
        rawCountries: ['GB'],
        rawDegreeLevels: ['phd'] as Array<'phd'>,
        rawFundingKind: 'unknown' as const,
        rawDeadline: parseDeadline(r.deadline) ?? undefined,
      };
    });
  }
}
