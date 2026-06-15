/**
 * Clear all existing opportunity data from Turso and re-scrape fresh.
 * Usage: npx tsx scripts/clear-and-rescrape.ts
 */
import { createClient } from '@libsql/client';
import { DAADSource } from '../src/sources/daad.js';
import { CheveningSource } from '../src/sources/chevening.js';
import { EuraxessSource } from '../src/sources/euraxess.js';
import { ErasmusSource } from '../src/sources/erasmus.js';
import { JobsAcUkSource } from '../src/sources/jobs-ac-uk.js';

const client = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function insertOpportunity(o: any) {
  const now = Math.floor(Date.now() / 1000);
  const id = `opp-${o.source}-${slug(o.externalId)}`;

  await client.execute({
    sql: `INSERT INTO opportunities (
            id, source, external_id, title, provider, official_url, description,
            type, fields, countries, degree_levels,
            funding_kind, funding_amount, funding_currency, funding_covers,
            deadline, ielts_required, application_fee, remote,
            requirements, documents, eligibility, benefits, tags,
            logo_url,
            status, last_seen_at, raw_payload,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            source=excluded.source, external_id=excluded.external_id,
            title=excluded.title, provider=excluded.provider,
            official_url=excluded.official_url, description=excluded.description,
            type=excluded.type, fields=excluded.fields, countries=excluded.countries,
            degree_levels=excluded.degree_levels,
            funding_kind=excluded.funding_kind, funding_amount=excluded.funding_amount,
            funding_currency=excluded.funding_currency, funding_covers=excluded.funding_covers,
            deadline=excluded.deadline, ielts_required=excluded.ielts_required,
            application_fee=excluded.application_fee, remote=excluded.remote,
            requirements=excluded.requirements, documents=excluded.documents,
            eligibility=excluded.eligibility, benefits=excluded.benefits, tags=excluded.tags,
            logo_url=excluded.logo_url,
            status=excluded.status, last_seen_at=excluded.last_seen_at,
            raw_payload=excluded.raw_payload,
            updated_at=excluded.updated_at`,
    args: [
      id,
      o.source,
      o.externalId,
      (o.title ?? '').slice(0, 500),
      (o.provider ?? '').slice(0, 200),
      o.url,
      o.description ?? null,
      o.type ?? 'scholarship',
      JSON.stringify(o.fields ?? []),
      JSON.stringify(o.countries ?? []),
      JSON.stringify(o.degreeLevels ?? []),
      o.funding.kind,
      o.funding.amount ?? null,
      o.funding.currency ?? null,
      JSON.stringify(o.funding.covers ?? []),
      o.deadline ? Math.floor(new Date(o.deadline).getTime() / 1000) : null,
      o.ieltsRequired ? 1 : 0,
      o.applicationFee ? 1 : 0,
      o.remote ? 1 : 0,
      JSON.stringify(o.requirements ?? []),
      JSON.stringify(o.documents ?? []),
      JSON.stringify(o.eligibility ?? []),
      JSON.stringify(o.benefits ?? []),
      JSON.stringify(o.tags ?? []),
      o.logoUrl ?? null,
      'approved',
      o.lastSeenAt ?? now,
      o.rawPayload ?? null,
      now,
      now,
    ],
  });
}

async function main() {
  const countBefore = await client.execute('SELECT COUNT(*) as n FROM opportunities');
  console.log(`🗑️  Clearing all opportunities from Turso...`);
  console.log(`   Found ${(countBefore.rows[0] as any).n} existing records`);

  await client.execute('DELETE FROM opportunities');
  console.log('   ✅ All opportunities deleted');

  console.log('\n🤖 Running all scrapers...');

  const sources = [
    new DAADSource(),
    new CheveningSource(),
    new EuraxessSource(),
    new ErasmusSource(),
    new JobsAcUkSource(),
  ];

  const ctx = {
    now: Math.floor(Date.now() / 1000),
    logger: console,
  };

  for (const source of sources) {
    console.log(`\n📡 Scraping ${source.displayName}...`);
    try {
      const startTime = Date.now();
      const listings = await source.fetch();
      console.log(`   Fetched ${listings.length} listings`);

      let inserted = 0;
      let errors = 0;
      for (const listing of listings) {
        try {
          const opp = await source.normalize(listing, { ...ctx, source: source.name });
          await insertOpportunity(opp);
          inserted++;
        } catch (e) {
          errors++;
          console.error(`   ❌ ${listing.title}: ${(e as Error).message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ ${inserted} inserted, ${errors} errors (${duration}s)`);
    } catch (e) {
      console.error(`   ❌ ${source.displayName} failed: ${(e as Error).message}`);
    }
  }

  const countAfter = await client.execute('SELECT COUNT(*) as n FROM opportunities');
  console.log(`\n🎉 Done! Total opportunities: ${(countAfter.rows[0] as any).n}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
