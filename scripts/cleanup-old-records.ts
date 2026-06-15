#!/usr/bin/env tsx
/**
 * Clean stale records before re-running the bot with corrected types.
 * Removes DAAD and Erasmus records so the bot re-inserts them with the
 * proper type classification (DAAD: programmtypId 7→research, 3/5→scholarship;
 * Erasmus: all→master).
 */
import { db } from '../src/db.js';

for (const source of ['daad', 'erasmus']) {
  const r = await db.raw.execute({
    sql: 'DELETE FROM opportunities WHERE source = ?',
    args: [source],
  });
  console.log(`deleted ${r.rowsAffected} ${source} records`);
}

const after = await db.raw.execute({
  sql: 'SELECT source, type, COUNT(*) as n FROM opportunities GROUP BY source, type ORDER BY source, type',
  args: [],
});
console.log('\nafter cleanup:');
for (const row of after.rows) {
  const x = row as unknown as { source: string | null; type: string | null; n: number };
  console.log(' ', (x.source ?? 'seed').padEnd(12), '|', (x.type ?? 'null').padEnd(12), '|', x.n);
}

await db.close();
