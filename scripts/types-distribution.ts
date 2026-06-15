#!/usr/bin/env tsx
import { db } from '../src/db.js';
const r = await db.raw.execute({
  sql: 'SELECT source, type, COUNT(*) as n FROM opportunities GROUP BY source, type ORDER BY n DESC',
  args: [],
});
for (const row of r.rows) {
  const x = row as unknown as { source: string | null; type: string | null; n: number };
  console.log((x.source ?? 'seed').padEnd(12), '|', (x.type ?? 'null').padEnd(12), '|', x.n);
}
await db.close();
