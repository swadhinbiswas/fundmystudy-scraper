#!/usr/bin/env tsx
/**
 * One-time backfill: classify EURAXESS records by title/description into
 * proper type (phd / postdoc / research).
 *
 * EURAXESS positions are research/teaching jobs, not scholarships.
 */
import { db } from '../src/db.js';

const r1 = await db.raw.execute({
  sql: `UPDATE opportunities SET type='phd'
        WHERE source='euraxess'
          AND (LOWER(title) LIKE '%phd%'
            OR LOWER(title) LIKE '%r1 %'
            OR LOWER(title) LIKE '%first stage%'
            OR LOWER(title) LIKE '%doctoral%'
            OR LOWER(title) LIKE '%young researcher%')`,
  args: [],
});
console.log('marked phd:', r1.rowsAffected);

const r2 = await db.raw.execute({
  sql: `UPDATE opportunities SET type='postdoc'
        WHERE source='euraxess' AND type != 'phd'
          AND (LOWER(title) LIKE '%post-?doc%'
            OR LOWER(title) LIKE '%postdoc%'
            OR LOWER(title) LIKE '%r2 %'
            OR LOWER(title) LIKE '%recognised researcher%')`,
  args: [],
});
console.log('marked postdoc:', r2.rowsAffected);

const r3 = await db.raw.execute({
  sql: `UPDATE opportunities SET type='research'
        WHERE source='euraxess' AND type NOT IN ('phd','postdoc','research')`,
  args: [],
});
console.log('marked research (rest):', r3.rowsAffected);

const dist = await db.raw.execute({
  sql: 'SELECT source, type, COUNT(*) as n FROM opportunities GROUP BY source, type ORDER BY source, type',
  args: [],
});
console.log('\nfinal distribution:');
for (const row of dist.rows) {
  const x = row as unknown as { source: string | null; type: string | null; n: number };
  console.log(' ', (x.source ?? 'seed').padEnd(12), '|', (x.type ?? 'null').padEnd(12), '|', x.n);
}

await db.close();
