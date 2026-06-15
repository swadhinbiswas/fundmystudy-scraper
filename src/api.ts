/**
 * Submission client. Thin wrapper over the direct Turso client (db.ts).
 *
 * The bot no longer goes through the worker — it writes directly to Turso.
 * This module keeps the same surface as before (submitBatch, listForSource)
 * so runner.ts and other consumers don't need to change.
 */
import type { Opportunity, SourceResult } from './types.js';
import { db } from './db.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';

const cfg = getConfig();

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    super(message ?? `API ${status}`);
    this.name = 'ApiError';
  }
}

/** @deprecated — kept for source compatibility. Use db.insertOpportunity() instead. */
export const api = {
  async submitBatch(
    items: Opportunity[],
  ): Promise<{ accepted: number; rejected: number; ids: string[] }> {
    const r = await db.insertOpportunityBatch(items);
    if (r.errors.length > 0 && r.inserted + r.updated === 0) {
      throw new ApiError(500, r.errors, r.errors[0]);
    }
    return {
      accepted: r.inserted + r.updated,
      rejected: r.errors.length,
      ids: items.map((_, i) => `db-${i}`),
    };
  },
  async submitOne(item: Opportunity): Promise<{ id: string }> {
    const id = await db.insertOpportunity(item);
    return { id };
  },
  async listForSource(source: string): Promise<{ items: Opportunity[] }> {
    return { items: await db.listOpportunitiesForSource(source) };
  },
  async health(): Promise<{ status: string }> {
    const ok = await db.ping();
    return { status: ok ? 'ok' : 'down' };
  },
  async approve(id: string): Promise<{ id: string; status: 'approved' }> {
    // Bot inserts with status='approved' by default; no-op here.
    return { id, status: 'approved' };
  },
  async reject(id: string): Promise<{ id: string; status: 'rejected' }> {
    return { id, status: 'rejected' };
  },
};

export async function submitBatch(
  items: Opportunity[],
): Promise<{ accepted: number; rejected: number; ids: string[] }> {
  if (cfg.DRY_RUN) {
    logger.info(
      { count: items.length, sample: items[0]?.title },
      '[dry-run] would submit batch',
    );
    return { accepted: items.length, rejected: 0, ids: items.map((_, i) => `dry-${i}`) };
  }
  return api.submitBatch(items);
}
