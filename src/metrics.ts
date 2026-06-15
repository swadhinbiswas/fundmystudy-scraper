/**
 * Tiny in-memory metrics. Increment counters, read at shutdown.
 * Plug into Prometheus / StatsD later.
 */
import { logger } from './logger.js';

interface SourceCounters {
  runs: number;
  fetched: number;
  normalized: number;
  submitted: number;
  skipped: number;
  errors: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

const counters = new Map<string, SourceCounters>();

function get(name: string): SourceCounters {
  let c = counters.get(name);
  if (!c) {
    c = {
      runs: 0,
      fetched: 0,
      normalized: 0,
      submitted: 0,
      skipped: 0,
      errors: 0,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
    };
    counters.set(name, c);
  }
  return c;
}

export const metrics = {
  incRun(name: string) {
    get(name).runs++;
  },
  incFetched(name: string, n: number) {
    get(name).fetched += n;
  },
  incNormalized(name: string, n: number) {
    get(name).normalized += n;
  },
  incSubmitted(name: string, n: number) {
    get(name).submitted += n;
  },
  incSkipped(name: string, n: number) {
    get(name).skipped += n;
  },
  incError(name: string, msg: string) {
    const c = get(name);
    c.errors++;
    c.lastError = msg;
  },
  finishRun(name: string, startedAt: number) {
    const c = get(name);
    c.lastRunAt = Date.now();
    c.lastDurationMs = Date.now() - startedAt;
  },
  snapshot() {
    return Array.from(counters.entries()).map(([name, c]) => ({ name, ...c }));
  },
};

export function report() {
  const snap = metrics.snapshot();
  logger.info({ sources: snap }, 'metrics snapshot');
  return snap;
}
