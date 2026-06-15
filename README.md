# FundMyStudy Scraper Bot

A Node.js service that scrapes scholarship opportunities from public sources and submits them to the FundMyStudy API for moderation.

## Architecture

```
src/
  index.ts          entrypoint
  config.ts         env loading + validation
  logger.ts         pino
  scheduler.ts      node-cron wrapper
  runner.ts         pipeline per source
  normalizer.ts     common normalization helpers
  deduper.ts        dedupe by external_id / url / title+provider
  api.ts            admin API client
  metrics.ts        per-source counters
  sources/
    base.ts         interface every source implements
    daad.ts         DAAD scholarship database
    erasmus.ts      Erasmus Mundus catalogue
    chevening.ts    Chevening programmes
scripts/
  test-source.ts    fetch + normalize a single source, print to stdout
  run-once.ts       run a single source end-to-end (fetch → POST)
```

## Quick start

```bash
cd bot
cp .env.example .env
# Edit .env — set ADMIN_TOKEN to match the worker's secret

# Install (Playwright will download Chromium on first install; ~150 MB)
npm install
npx playwright install chromium

# Type check
npm run typecheck

# Run all enabled sources once
npm run run:once

# Test a single source without POSTing
npm run test:source -- daad
```

## Adding a new source

1. Create `src/sources/<name>.ts`:

```ts
import { BaseSource, RawListing } from './base.js';

export class MySource extends BaseSource {
  readonly name = 'mysource';
  readonly schedule = '0 */12 * * *'; // every 12h
  readonly url = 'https://example.com/scholarships';

  async fetch(): Promise<RawListing[]> {
    const html = await this.http.get(this.url);
    const $ = cheerio.load(html);
    // … parse to RawListing[]
  }
}
```

2. Register it in `src/sources/index.ts`:

```ts
import { MySource } from './mysource.js';
export const SOURCES: SourceMeta[] = [
  // …
  { name: 'mysource', class: MySource, enabled: true },
];
```

3. Add it to `.env` `SOURCES=mysource,daad,erasmus`.

4. Write a test in `tests/sources/mysource.test.ts`.

## Hosting

Recommended: **Fly.io** (free tier), **Railway**, or a $5/mo VPS.

```bash
# Example: run on Fly.io
fly launch
fly secrets set ADMIN_TOKEN=... API_BASE_URL=...
fly deploy
```

For cron-only operation (no always-on process):

```bash
# Cron syntax: every 6h
0 */6 * * * cd /app && npm run run:once >> /var/log/bot.log 2>&1
```

## Legal

- We only scrape **publicly accessible** pages, never behind login walls.
- We respect `robots.txt` where set.
- We send `User-Agent: FundMyStudyBot/0.1` so sites can contact us.
- We throttle requests: max 1 req/s per source, 2 sources in parallel.
- Attribution: every submitted opportunity has a `source` field; the mobile app shows it.

If a source asks us to stop, remove it from `SOURCES`. Don't bypass blocks.

## Observability

- Logs go to stdout in JSON (pino). Pipe to your log sink.
- Set `SENTRY_DSN` to forward errors to Sentry (TODO).
- Per-source counters in `metrics.ts` — pluggable to a Prometheus endpoint.

## Tests

```bash
npm test                 # unit tests
npm run test:source      # one-off fetch test
```
