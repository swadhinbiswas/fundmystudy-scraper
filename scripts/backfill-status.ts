#!/usr/bin/env tsx
/**
 * One-time backfill: bot-ingested records should be status='approved'.
 * (Worker only surfaces approved records; bot bypasses admin review.)
 */
import { db } from '../src/db.js';

const r = await db.raw.execute(
  "UPDATE opportunities SET status='approved', updated_at=? WHERE status='pending'",
  [Math.floor(Date.now() / 1000)],
);
console.log('backfilled rows:', r.rowsAffected);

const after = await db.raw.execute(
  'SELECT status, COUNT(*) as n FROM opportunities GROUP BY status',
);
console.log('after:', after.rows);
await db.close();
