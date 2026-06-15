#!/usr/bin/env tsx
/**
 * Verify Turso state.
 *   tsx scripts/verify.ts
 *   tsx scripts/verify.ts opportunities
 *   tsx scripts/verify.ts phd_positions
 */
import { db } from '../src/db.js';

async function main() {
  const target = process.argv[2];

  if (target === 'opportunities' || !target) {
    const total = await db.raw.execute('SELECT COUNT(*) as n FROM opportunities');
    console.log('opportunities.total:', (total.rows[0] as unknown as { n: number }).n);
    const recent = await db.raw.execute({
      sql: 'SELECT id, source, status, last_seen_at, created_at, updated_at, title FROM opportunities ORDER BY created_at DESC LIMIT 5',
    });
    console.log('opportunities.recent:');
    for (const r of recent.rows) {
      const row = r as unknown as { id: string; source: string | null; status: string; last_seen_at: number | null; created_at: number; updated_at: number; title: string };
      console.log(`  - [${row.source ?? 'seed'}] ${row.title.slice(0, 50)}  status=${row.status} last_seen=${row.last_seen_at} created=${row.created_at} updated=${row.updated_at} (id=${row.id})`);
    }
  }

  if (target === 'phd_positions' || !target) {
    const total = await db.raw.execute('SELECT COUNT(*) as n FROM phd_positions');
    console.log('phd_positions.total:', (total.rows[0] as unknown as { n: number }).n);
    const recent = await db.raw.execute({
      sql: 'SELECT id, source_id, title, university_name FROM phd_positions ORDER BY scraped_at DESC LIMIT 5',
    });
    console.log('phd_positions.recent:');
    for (const r of recent.rows) {
      const row = r as unknown as { id: string; source_id: string; title: string; university_name: string };
      console.log(`  - [${row.source_id}] ${row.title.slice(0, 50)} @ ${row.university_name}`);
    }
  }

  if (target === 'scraper_runs' || !target) {
    const runs = await db.raw.execute({
      sql: 'SELECT source_id, status, items_fetched, items_inserted, duration_ms FROM scraper_runs ORDER BY started_at DESC LIMIT 10',
    });
    console.log('scraper_runs.recent:');
    for (const r of runs.rows) {
      const row = r as unknown as { source_id: string; status: string; items_fetched: number; items_inserted: number; duration_ms: number };
      console.log(`  - ${row.source_id.padEnd(15)} ${row.status.padEnd(8)} fetched=${row.items_fetched} inserted=${row.items_inserted} dur=${row.duration_ms}ms`);
    }
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
