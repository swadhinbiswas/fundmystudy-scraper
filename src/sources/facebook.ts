/**
 * Facebook — public groups via Graph API.
 *
 * Uses a user/page access token to fetch posts from Facebook groups.
 * Requires:
 *   FACEBOOK_ACCESS_TOKEN  — long-lived token (user or page)
 *   FACEBOOK_GROUPS        — comma-separated group IDs, e.g. "12345,67890"
 *
 * Graph API: GET https://graph.facebook.com/v18.0/{group-id}/feed
 *   ?fields=id,message,created_time,permalink_url,from
 *   &access_token={token}
 *
 * For a user token the user must be a member of the group.
 * For a page token the group must be public (or the page is admin).
 */
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';
import type { RawListing } from '../types.js';

const API_VERSION = 'v18.0';
const OPPORTUNITY_KEYWORDS =
  /\b(scholarship|fellowship|grant|phd|position|postdoc|studentship|fully[\s-]?funded|stipend|funding|apply|application|opening|admission|hiring|recruit|professor|tenure|researcher|vacancy|assistantship|award)\b/i;

interface FbPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  from?: { name?: string; id?: string };
}

interface FbFeedResponse {
  data?: FbPost[];
  error?: { message: string; type: string; code: number };
}

function classify(text: string): 'phd' | 'research' | 'scholarship' {
  const t = text.toLowerCase();
  if (/\b(phd|doctoral|studentship)\b/.test(t)) return 'phd';
  if (/\b(postdoc|professor|tenure|researcher|fellowship)\b/.test(t)) return 'research';
  return 'scholarship';
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

export class FacebookSource extends BaseSource {
  readonly name = 'facebook';
  readonly displayName = 'Facebook (scholarship & PhD groups)';
  readonly schedule = '0 */6 * * *';
  readonly origin = 'https://www.facebook.com';

  async fetch(): Promise<RawListing[]> {
    const cfg = getConfig();
    const token = cfg.FACEBOOK_ACCESS_TOKEN;
    const groupsStr = process.env.FACEBOOK_GROUPS ?? '';
    if (!token) {
      logger.info('facebook: skipped (FACEBOOK_ACCESS_TOKEN not set)');
      return [];
    }
    const groups = groupsStr.split(',').map((g) => g.trim()).filter(Boolean);
    if (groups.length === 0) {
      logger.info(
        'facebook: skipped (FACEBOOK_GROUPS empty — set to comma-separated group IDs)',
      );
      return [];
    }

    const out: RawListing[] = [];
    const seen = new Set<string>();

    for (const groupId of groups) {
      try {
        const url = `https://graph.facebook.com/${API_VERSION}/${groupId}/feed?fields=id,message,created_time,permalink_url,from&limit=50&access_token=${encodeURIComponent(token)}`;
        const json = await httpGet(url, { headers: { 'User-Agent': 'FundMyStudyBot/1.0' } });
        const data = JSON.parse(json) as FbFeedResponse;
        if (data.error) {
          logger.warn(
            { group: groupId, code: data.error.code, msg: data.error.message },
            'facebook graph api error',
          );
          continue;
        }
        const posts = data.data ?? [];
        logger.info({ group: groupId, count: posts.length }, 'facebook: parsed');
        for (const p of posts) {
          if (!p.id || seen.has(p.id) || !p.message) continue;
          const text = p.message;
          if (!OPPORTUNITY_KEYWORDS.test(text)) continue;
          seen.add(p.id);

          const kind = classify(text);
          const fields = inferFields(text);
          const lower = text.toLowerCase();
          const funding = /fully[\s-]?funded|stipend/.test(lower)
            ? 'full'
            : /funded/.test(lower)
              ? 'partial'
              : 'unknown';

          out.push({
            externalId: `fb-${p.id}`,
            url: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
            title: text.split('\n')[0]?.slice(0, 200) || `Facebook post from ${p.from?.name ?? 'group'}`,
            provider: `Facebook: ${p.from?.name ?? groupId}`,
            description: text.slice(0, 1500),
            rawFields: fields,
            rawCountries: ['GLOBAL'],
            rawDegreeLevels:
              kind === 'phd' ? ['phd'] : kind === 'scholarship' ? ['master', 'bachelor'] : ['phd', 'postdoc'],
            rawFundingKind: funding as 'full' | 'partial' | 'unknown',
          });
        }
      } catch (e) {
        logger.warn(
          { err: (e as Error).message, group: groupId },
          'facebook fetch failed',
        );
      }
    }

    return out;
  }
}
