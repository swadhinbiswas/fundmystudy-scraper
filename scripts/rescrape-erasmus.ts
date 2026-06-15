import { createClient } from '@libsql/client';
import { ErasmusSource } from '../src/sources/erasmus.js';

const client = createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function main() {
  await client.execute("DELETE FROM opportunities WHERE source = 'erasmus'");
  console.log('Deleted old erasmus records');

  const source = new ErasmusSource();
  const listings = await source.fetch();
  console.log('Fetched:', listings.length);

  const now = Math.floor(Date.now() / 1000);

  for (const listing of listings) {
    const opp = await source.normalize(listing, { source: 'erasmus', now, logger: console });
    const oppId = 'opp-erasmus-' + slug(opp.externalId);

    await client.execute({
      sql: `INSERT INTO opportunities (id, source, external_id, title, provider, official_url, description, type, fields, countries, degree_levels, funding_kind, funding_amount, funding_currency, funding_covers, deadline, ielts_required, application_fee, remote, requirements, documents, eligibility, benefits, tags, logo_url, status, last_seen_at, raw_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, external_id=excluded.external_id, title=excluded.title, provider=excluded.provider, official_url=excluded.official_url, description=excluded.description, type=excluded.type, fields=excluded.fields, countries=excluded.countries, degree_levels=excluded.degree_levels, funding_kind=excluded.funding_kind, funding_amount=excluded.funding_amount, funding_currency=excluded.funding_currency, funding_covers=excluded.funding_covers, deadline=excluded.deadline, ielts_required=excluded.ielts_required, application_fee=excluded.application_fee, remote=excluded.remote, requirements=excluded.requirements, documents=excluded.documents, eligibility=excluded.eligibility, benefits=excluded.benefits, tags=excluded.tags, logo_url=excluded.logo_url, status=excluded.status, last_seen_at=excluded.last_seen_at, raw_payload=excluded.raw_payload, updated_at=excluded.updated_at`,
      args: [oppId, opp.source, opp.externalId, (opp.title ?? '').slice(0, 500), (opp.provider ?? '').slice(0, 200), opp.url, opp.description ?? null, opp.type ?? 'scholarship', JSON.stringify(opp.fields ?? []), JSON.stringify(opp.countries ?? []), JSON.stringify(opp.degreeLevels ?? []), opp.funding.kind, opp.funding.amount ?? null, opp.funding.currency ?? null, JSON.stringify(opp.funding.covers ?? []), opp.deadline ? Math.floor(new Date(opp.deadline).getTime() / 1000) : null, opp.ieltsRequired ? 1 : 0, opp.applicationFee ? 1 : 0, opp.remote ? 1 : 0, JSON.stringify(opp.requirements ?? []), JSON.stringify(opp.documents ?? []), JSON.stringify(opp.eligibility ?? []), JSON.stringify(opp.benefits ?? []), JSON.stringify(opp.tags ?? []), opp.logoUrl ?? null, 'approved', opp.lastSeenAt ?? now, null, now, now],
    });
  }
  console.log('Inserted', listings.length, 'erasmus records');
}

main();
