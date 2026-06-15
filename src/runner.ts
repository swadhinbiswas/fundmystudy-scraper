/**
 * Runner: orchestrates one source end-to-end.
 *   fetch → validate → normalize → dedupe → POST
 */
import { BaseSource, type SourceContext } from './sources/base.js';
import { Deduper } from './deduper.js';
import { api, submitBatch, ApiError } from './api.js';
import { metrics } from './metrics.js';
import { logger } from './logger.js';
import type { Opportunity, RawListing, SourceResult } from './types.js';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runSource(source: BaseSource): Promise<SourceResult> {
  const startedAt = Date.now();
  metrics.incRun(source.name);
  const ctx: SourceContext = {
    source: source.name,
    now: startedAt,
    logger: {
      info: (o, m) =>
        logger.info({ source: source.name, ...((typeof o === 'object' && o) || {}) }, m),
      warn: (o, m) =>
        logger.warn({ source: source.name, ...((typeof o === 'object' && o) || {}) }, m),
      error: (o, m) =>
        logger.error({ source: source.name, ...((typeof o === 'object' && o) || {}) }, m),
    },
  };

  try {
    logger.info({ source: source.name }, 'fetching');
    const raw: RawListing[] = await source.fetch();
    metrics.incFetched(source.name, raw.length);
    logger.info({ source: source.name, fetched: raw.length }, 'fetched');

    // Validate
    const valid: RawListing[] = [];
    let skipped = 0;
    for (const r of raw) {
      const err = source.validate(r);
      if (err) {
        skipped++;
        logger.debug({ source: source.name, externalId: r.externalId, err }, 'skipped invalid');
      } else {
        valid.push(r);
      }
    }
    metrics.incSkipped(source.name, skipped);

    if (valid.length === 0) {
      logger.warn({ source: source.name, skipped }, 'no valid listings after validation');
      return result({
        source: source.name,
        fetched: raw.length,
        normalized: 0,
        submitted: 0,
        skipped,
        errors: 0,
        startedAt,
      });
    }

    // Normalize
    const normalized: Opportunity[] = [];
    for (const r of valid) {
      try {
        const o = await source.normalize(r, ctx);
        normalized.push(o);
      } catch (e) {
        metrics.incError(source.name, e instanceof Error ? e.message : String(e));
        logger.error(
          { source: source.name, externalId: r.externalId, err: (e as Error).message },
          'normalize failed',
        );
      }
    }
    metrics.incNormalized(source.name, normalized.length);
    logger.info({ source: source.name, normalized: normalized.length }, 'normalized');

    // Dedupe against remote
    let seed: Opportunity[] = [];
    try {
      const remote = await api.listForSource(source.name);
      seed = remote.items ?? [];
      logger.debug({ source: source.name, remote: seed.length }, 'loaded remote for dedupe');
    } catch (e) {
      // 401/403/5xx — fall back to in-process dedupe only
      logger.warn(
        { source: source.name, err: (e as Error).message },
        'remote dedupe failed, using in-process only',
      );
    }
    const deduper = Deduper.fromRemote(seed);
    const unique = deduper.unique(normalized);
    logger.info(
      { source: source.name, unique: unique.length, dropped: normalized.length - unique.length },
      'deduped',
    );

    if (unique.length === 0) {
      return result({
        source: source.name,
        fetched: raw.length,
        normalized: normalized.length,
        submitted: 0,
        skipped,
        errors: 0,
        startedAt,
      });
    }

    // Submit in batches of 50
    let submitted = 0;
    for (const batch of chunk(unique, 50)) {
      try {
        const res = await submitBatch(batch);
        submitted += res.accepted;
        logger.info(
          { source: source.name, accepted: res.accepted, rejected: res.rejected },
          'batch submitted',
        );
      } catch (e) {
        if (e instanceof ApiError) {
          metrics.incError(source.name, `${e.status}: ${String(e.body).slice(0, 200)}`);
          logger.error({ source: source.name, status: e.status, body: e.body }, 'submit failed');
        } else {
          metrics.incError(source.name, (e as Error).message);
          logger.error({ source: source.name, err: (e as Error).message }, 'submit failed');
        }
        break;
      }
    }
    metrics.incSubmitted(source.name, submitted);

    return result({
      source: source.name,
      fetched: raw.length,
      normalized: normalized.length,
      submitted,
      skipped,
      errors: 0,
      startedAt,
    });
  } catch (e) {
    metrics.incError(source.name, (e as Error).message);
    logger.error(
      { source: source.name, err: (e as Error).message, stack: (e as Error).stack },
      'source failed',
    );
    return result({
      source: source.name,
      fetched: 0,
      normalized: 0,
      submitted: 0,
      skipped: 0,
      errors: 1,
      startedAt,
    });
  } finally {
    metrics.finishRun(source.name, startedAt);
  }
}

function result(r: Omit<SourceResult, 'finishedAt' | 'durationMs'>): SourceResult {
  const finishedAt = Date.now();
  return { ...r, finishedAt, durationMs: finishedAt - r.startedAt };
}
