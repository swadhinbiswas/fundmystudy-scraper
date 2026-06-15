/**
 * Minimal HTTP client built on undici.
 *  - timeout
 *  - retry with exponential backoff + jitter
 *  - throttling: 1 req/s per host (token bucket)
 *  - respects Retry-After
 */
import { request, Agent } from 'undici';
import { getConfig } from './config.js';

const cfg = getConfig();
const agent = new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000 });

const lastByHost = new Map<string, number>();
const MIN_GAP_MS = 1_000; // 1 req/s per host

async function throttle(host: string) {
  const last = lastByHost.get(host) ?? 0;
  const wait = MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastByHost.set(host, Date.now());
}

function backoff(attempt: number): number {
  const base = 500 * 2 ** attempt;
  return base + Math.random() * 200;
}

function isRetryable(status: number) {
  return status === 0 || (status >= 500 && status < 600) || status === 408 || status === 429;
}

export interface GetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** When true, parse response as text without any throttling. Use sparingly. */
  skipThrottle?: boolean;
}

export async function get(url: string, opts: GetOptions = {}): Promise<string> {
  const u = new URL(url);
  const timeoutMs = opts.timeoutMs ?? cfg.HTTP_TIMEOUT_MS;
  const retries = opts.retries ?? cfg.HTTP_RETRY;

  if (!opts.skipThrottle) await throttle(u.host);

  const headers: Record<string, string> = {
    'User-Agent': cfg.USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...opts.headers,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Follow up to 5 redirects manually (undici v7 doesn't expose maxRedirections
      // the same way across versions).
      let currentUrl = url;
      for (let i = 0; i < 5; i++) {
        const res = await request(currentUrl, {
          method: 'GET',
          headers,
          dispatcher: agent,
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers['location'];
          await res.body.dump();
          if (typeof loc === 'string' && loc) {
            currentUrl = new URL(loc, currentUrl).toString();
            continue;
          }
        }
        if (res.statusCode === 200) {
          const text = await res.body.text();
          await res.body.dump();
          return text;
        }
        if (!isRetryable(res.statusCode) || attempt === retries) {
          const text = await res.body.text();
          throw new HttpError(
            res.statusCode,
            `HTTP ${res.statusCode} for ${url}: ${text.slice(0, 200)}`,
          );
        }
        const retryAfter = Number(res.headers['retry-after']);
        const wait =
          !Number.isNaN(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        await res.body.dump();
        await new Promise((r) => setTimeout(r, wait));
        break; // exit redirect loop, retry
      }
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError) throw err;
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, backoff(attempt)));
    }
  }
  throw lastError ?? new Error(`unreachable: ${url}`);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
