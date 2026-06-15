/**
 * Reddit — PhD, scholarships, and grad admissions communities.
 *
 * Reddit exposes a public JSON API: append `.json` to any subreddit URL.
 * No authentication required for public subreddits.
 *
 * Sources:
 *   r/PhD                  — PhD life, positions, advice
 *   r/scholarships          — scholarship announcements
 *   r/gradadmissions        — grad school admissions
 *   r/AskAcademia          — academic job questions
 *   r/phd_positions         — direct PhD position postings
 *   r/funding              — research funding
 *
 * Each post becomes a RawListing with the Reddit thread as the URL.
 * Posts that look like opportunity announcements (titles with "PhD",
 * "position", "scholarship", "fellowship", etc.) are kept.
 */
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import type { RawListing } from '../types.js';

const SUBREDDITS = [
  'phd_positions',
  'scholarships',
  'gradadmissions',
];

const OPPORTUNITY_KEYWORDS =
  /\b(phd position|phd studentship|postdoc position|postdoctoral position|research position|research fellowship|fully[\s-]?funded|stipend|scholarship|fellowship|grant|call for applications|applications open|apply by|deadline|hiring|recruitment|vacancy|assistantship|graduate position|funded position)\b/i;

// Reddit sometimes blocks the JSON API. Try RSS as a fallback.
const ACCEPT_JSON = 'application/json';
const ACCEPT_RSS = 'application/atom+xml, application/rss+xml, application/xml';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function looksLikeOpportunity(title: string, selftext: string, url: string): boolean {
  // Match if:
  //   1. Title contains an opportunity phrase (most reliable signal)
  //   2. OR (selftext contains opportunity phrase AND post has an external link)
  if (OPPORTUNITY_KEYWORDS.test(title)) return true;
  const isExternal = url && !url.includes('reddit.com') && url.startsWith('http');
  if (isExternal && OPPORTUNITY_KEYWORDS.test(selftext.slice(0, 800))) return true;
  return false;
}

function classify(title: string, selftext: string): 'phd' | 'research' | 'scholarship' {
  const text = `${title} ${selftext}`.toLowerCase();
  if (/\b(phd|doctoral|studentship)\b/.test(text)) return 'phd';
  if (/\b(postdoc|professor|tenure|researcher|fellowship)\b/.test(text)) return 'research';
  if (/\b(scholarship|grant|funding|stipend)\b/.test(text)) return 'scholarship';
  return 'research';
}

function inferFields(text: string): string[] {
  const t = text.toLowerCase();
  const fields: string[] = [];
  if (/computer|software|ai|machine learning|data|cyber/.test(t)) fields.push('Computer Science');
  if (/engineer|mechanical|electrical|civil|chemical/.test(t)) fields.push('Engineering');
  if (/biology|chemistry|physics/.test(t)) fields.push('Science');
  if (/business|management|finance|economic/.test(t)) fields.push('Business');
  if (/medic|health|clinical|pharma/.test(t)) fields.push('Medicine');
  if (/math|statistic/.test(t)) fields.push('Mathematics');
  if (/law|legal|political/.test(t)) fields.push('Law');
  if (/art|design|architect|music/.test(t)) fields.push('Arts');
  if (fields.length === 0) fields.push('all');
  return fields;
}

/** Parse a Reddit RSS feed (Atom XML) into RedditPost[]. */
function parseRss(xml: string): RedditPost[] {
  const posts: RedditPost[] = [];
  const itemRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const body = m[1] ?? '';
    const tag = (name: string): string => {
      const r = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
      const m = r.exec(body);
      if (!m) return '';
      const captured = m[1];
      return captured ? captured.trim() : '';
    };
    const title = tag('title').replace(/<[^>]+>/g, '').trim();
    const id = tag('id').replace(/^.*\//, '').trim();
    const authorRe = /<author>\s*<name>([^<]+)<\/name>/i;
    const authorMatch = authorRe.exec(body);
    const author = authorMatch && authorMatch[1] ? authorMatch[1].replace(/^\/u\//, '') : '';
    const subredditRe = /\/r\/([A-Za-z0-9_]+)\//i;
    const subMatch = subredditRe.exec(body);
    const subreddit = subMatch && subMatch[1] ? subMatch[1] : '';
    const linkRe = /<link[^>]+href="([^"]+)"/i;
    const linkMatch = linkRe.exec(body);
    const link = linkMatch && linkMatch[1] ? linkMatch[1] : '';
    const contentRe = /<content[^>]*>([\s\S]*?)<\/content>/i;
    const contentMatch = contentRe.exec(body);
    const selftext = contentMatch && contentMatch[1]
      ? contentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    if (!title || !id) continue;
    posts.push({
      data: {
        id,
        title,
        url: link,
        permalink: link,
        selftext,
        author,
        subreddit,
        created_utc: 0,
        num_comments: 0,
        score: 0,
      },
    });
  }
  return posts;
}

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    permalink: string;
    selftext?: string;
    author: string;
    subreddit: string;
    created_utc: number;
    num_comments: number;
    score: number;
  };
}

interface RedditListing {
  data: { children: RedditPost[] };
}

export class RedditSource extends BaseSource {
  readonly name = 'reddit';
  readonly displayName = 'Reddit (PhD, scholarships, grad admissions)';
  readonly schedule = '0 */6 * * *';
  readonly origin = 'https://www.reddit.com';

  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<string>();

    for (const sub of SUBREDDITS) {
      // Throttle: 5s between subreddits to avoid Reddit IP-level blocks
      await new Promise((r) => setTimeout(r, 5000));

      // Try JSON API first, fall back to RSS only if JSON returns a non-rate-limit error
      const jsonUrl = `https://www.reddit.com/r/${sub}/new.json?limit=25`;
      const rssUrl = `https://www.reddit.com/r/${sub}/new/.rss`;

      let posts: RedditPost[] = [];
      try {
        const json = await httpGet(jsonUrl, {
          headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT_JSON },
        });
        const data = JSON.parse(json) as RedditListing;
        posts = data?.data?.children ?? [];
      } catch (e) {
        const err = (e as Error).message;
        // If rate-limited, don't try RSS (same host, same rate limit). Skip.
        if (/429|403/.test(err)) {
          logger.warn({ sub, err: err.slice(0, 100) }, 'reddit rate-limited, skipping');
          continue;
        }
        // Fallback to RSS for other errors
        try {
          const xml = await httpGet(rssUrl, {
            headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT_RSS },
          });
          posts = parseRss(xml);
        } catch (e2) {
          logger.warn(
            { err: (e2 as Error).message, sub },
            'reddit both JSON and RSS failed',
          );
          continue;
        }
      }

      logger.info({ sub, count: posts.length }, 'reddit: parsed');

      for (const post of posts) {
        const d = post.data;
        if (!d || seen.has(d.id)) continue;
        const selftext = d.selftext ?? '';
        const postUrl = d.url && !d.url.includes('reddit.com')
          ? d.url
          : d.permalink || `https://www.reddit.com/r/${sub}/comments/${d.id}`;
        if (!looksLikeOpportunity(d.title, selftext, postUrl)) continue;
        seen.add(d.id);

        const url = postUrl;

        const kind = classify(d.title, selftext);
        const fields = inferFields(`${d.title} ${selftext}`);
        const text = `${d.title} ${selftext}`.toLowerCase();
        const funding = /fully[\s-]?funded|stipend/.test(text)
          ? 'full'
          : /funded/.test(text)
            ? 'partial'
            : 'unknown';

        out.push({
          externalId: `reddit-${d.id}`,
          url,
          title: d.title,
          provider: `r/${d.subreddit || sub} (u/${d.author || 'unknown'})`,
          description: selftext.slice(0, 1500) || d.title,
          rawFields: fields,
          rawCountries: ['GLOBAL'],
          rawDegreeLevels:
            kind === 'phd' ? ['phd'] : kind === 'scholarship' ? ['master', 'bachelor'] : ['phd', 'postdoc'],
          rawFundingKind: funding as 'full' | 'partial' | 'unknown',
        });
      }
    }

    return out;
  }
}
