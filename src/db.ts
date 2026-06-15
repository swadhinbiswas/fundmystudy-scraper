/**
 * Direct Turso database client.
 *
 * The bot writes scraped opportunities directly to the DB — no worker hop.
 * Schema matches the worker's existing tables (0001_init.sql, 0007_phd_positions.sql).
 */
import { createClient, type Client } from '@libsql/client';
import type { Opportunity, RawListing } from './types.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';

let _client: Client | null = null;

export type PhdPositionInput = {
  sourceId: string;
  externalId: string;
  title: string;
  universityName: string;
  universityId?: string | null;
  professorId?: string | null;
  country?: string;
  city?: string;
  department?: string;
  fieldTags?: string[];
  description?: string;
  requirements?: string[];
  fundingAvailable?: boolean;
  fundingDetails?: string;
  applicationUrl: string;
  deadline?: number | null;
  postedAt?: number | null;
};

export type ScraperRunInput = {
  sourceId: string;
  sourceName?: string;
  sourceType?: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'partial' | 'failed';
  itemsFetched: number;
  itemsInserted: number;
  itemsUpdated: number;
  errors?: string[];
  durationMs: number;
};

export type UniversityInput = {
  id: string;
  name: string;
  country?: string;
  city?: string;
  website?: string;
};

function getClient(): Client {
  if (_client) return _client;
  const cfg = getConfig();
  _client = createClient({ url: cfg.TURSO_URL, authToken: cfg.TURSO_AUTH_TOKEN });
  return _client;
}

export const db: {
  raw: Client;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  insertOpportunity(o: Opportunity): Promise<string>;
  insertOpportunityBatch(items: Opportunity[]): Promise<{ inserted: number; updated: number; errors: string[] }>;
  existsOpportunity(source: string, externalId: string): Promise<boolean>;
  listOpportunitiesForSource(source: string): Promise<Opportunity[]>;
  insertPhdPosition(p: PhdPositionInput): Promise<string>;
  insertPhdPositionBatch(items: PhdPositionInput[]): Promise<{ inserted: number; updated: number; errors: string[] }>;
  recordScraperRun(r: ScraperRunInput): Promise<void>;
  upsertUniversity(u: UniversityInput): Promise<void>;
  findUniversityByName(name: string): Promise<string | null>;
} = {
  raw: getClient(),

  async ping(): Promise<boolean> {
    try {
      const r = await getClient().execute('SELECT 1 as v');
      return r.rows.length > 0 && (r.rows[0] as unknown as { v: number }).v === 1;
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'db ping failed');
      return false;
    }
  },

  async close() {
    if (_client) await _client.close();
  },

  // ---------- opportunities (scholarships) ----------

  async insertOpportunity(o: Opportunity): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const id = `opp-${o.source}-${slug(o.externalId)}`;
    await getClient().execute({
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
        o.title.slice(0, 500),
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
        o.status === 'pending' ? 'approved' : o.status ?? 'approved',
        o.lastSeenAt ?? now,
        o.rawPayload ?? null,
        now,
        now,
      ],
    });
    return id;
  },

  async insertOpportunityBatch(items: Opportunity[]): Promise<{ inserted: number; updated: number; errors: string[] }> {
    let inserted = 0, updated = 0;
    const errors: string[] = [];
    for (const o of items) {
      try {
        const wasNew = !(await this.existsOpportunity(o.source, o.externalId));
        await this.insertOpportunity(o);
        if (wasNew) inserted++; else updated++;
      } catch (e) {
        errors.push(`${o.source}/${o.externalId}: ${(e as Error).message}`);
      }
    }
    return { inserted, updated, errors };
  },

  async existsOpportunity(source: string, externalId: string): Promise<boolean> {
    const r = await getClient().execute({
      sql: 'SELECT 1 FROM opportunities WHERE source = ? AND external_id = ? LIMIT 1',
      args: [source, externalId],
    });
    return r.rows.length > 0;
  },

  async listOpportunitiesForSource(source: string): Promise<Opportunity[]> {
    const r = await getClient().execute({
      sql: 'SELECT * FROM opportunities WHERE source = ? LIMIT 1000',
      args: [source],
    });
    return (r.rows as unknown as Record<string, unknown>[]).map(rowToOpportunity);
  },

  // ---------- phd_positions (PhD recruitment boards) ----------

  async insertPhdPosition(p: PhdPositionInput): Promise<string> {
    const now = Date.now();
    const id = `pos-${p.sourceId}-${slug(p.externalId).slice(0, 80)}`;
    const fieldsJson = JSON.stringify(p.fieldTags ?? ['all']);
    const existing = await getClient().execute({
      sql: 'SELECT id FROM phd_positions WHERE id = ? LIMIT 1',
      args: [id],
    });
    if (existing.rows.length > 0) {
      await getClient().execute({
        sql: `UPDATE phd_positions SET
                title=?, university_id=?, university_name=?, professor_id=?,
                department=?, country=?, city=?, field_tags=?, description=?,
                funding_available=?, funding_details=?,
                application_url=?, deadline=?, posted_at=?, scraped_at=?, is_active=1
              WHERE id=?`,
        args: [
          p.title.slice(0, 500),
          p.universityId ?? null,
          p.universityName.slice(0, 200),
          p.professorId ?? null,
          p.department ?? '',
          p.country ?? '',
          p.city ?? '',
          fieldsJson,
          p.description ?? '',
          p.fundingAvailable ? 1 : 0,
          p.fundingDetails ?? '',
          p.applicationUrl,
          p.deadline ?? null,
          p.postedAt ?? null,
          now,
          id,
        ],
      });
    } else {
      await getClient().execute({
        sql: `INSERT INTO phd_positions (
                id, source_id, external_id, title, university_id, university_name, professor_id,
                department, country, city, field_tags, description,
                funding_available, funding_details, application_url,
                posted_at, deadline, scraped_at, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          id,
          p.sourceId,
          p.externalId.slice(0, 500),
          p.title.slice(0, 500),
          p.universityId ?? null,
          p.universityName.slice(0, 200),
          p.professorId ?? null,
          p.department ?? '',
          p.country ?? '',
          p.city ?? '',
          fieldsJson,
          p.description ?? '',
          p.fundingAvailable ? 1 : 0,
          p.fundingDetails ?? '',
          p.applicationUrl,
          p.postedAt ?? null,
          p.deadline ?? null,
          now,
        ],
      });
    }
    return id;
  },

  async insertPhdPositionBatch(items: PhdPositionInput[]): Promise<{ inserted: number; updated: number; errors: string[] }> {
    let inserted = 0, updated = 0;
    const errors: string[] = [];
    for (const p of items) {
      try {
        const id = `pos-${p.sourceId}-${slug(p.externalId).slice(0, 80)}`;
        const existing = await getClient().execute({
          sql: 'SELECT id FROM phd_positions WHERE id = ? LIMIT 1',
          args: [id],
        });
        const wasNew = existing.rows.length === 0;
        await this.insertPhdPosition(p);
        if (wasNew) inserted++; else updated++;
      } catch (e) {
        errors.push(`${p.sourceId}/${p.externalId}: ${(e as Error).message}`);
      }
    }
    return { inserted, updated, errors };
  },

  // ---------- scraper_runs ----------

  async recordScraperRun(r: ScraperRunInput): Promise<void> {
    const id = `run-${slug(r.sourceId)}-${r.startedAt}`;
    try {
      await getClient().execute({
        sql: `INSERT OR REPLACE INTO scraper_runs (
                id, source_id, source_name, source_type,
                started_at, finished_at, status,
                items_fetched, items_inserted, items_updated,
                errors, duration_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          r.sourceId,
          r.sourceName ?? r.sourceId,
          r.sourceType ?? 'bot',
          r.startedAt,
          r.finishedAt,
          r.status,
          r.itemsFetched,
          r.itemsInserted,
          r.itemsUpdated,
          JSON.stringify((r.errors ?? []).slice(0, 50)),
          r.durationMs,
        ],
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'recordScraperRun failed');
    }
  },

  // ---------- universities (auto-discover from position listings) ----------

  async upsertUniversity(u: UniversityInput): Promise<void> {
    const now = Date.now();
    try {
      await getClient().execute({
        sql: `INSERT INTO universities (id, name, country, city, website, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, country=COALESCE(NULLIF(excluded.country, ''), universities.country),
                city=COALESCE(NULLIF(excluded.city, ''), universities.city),
                website=COALESCE(NULLIF(excluded.website, ''), universities.website),
                updated_at=excluded.updated_at`,
        args: [u.id, u.name, u.country ?? '', u.city ?? '', u.website ?? '', now, now],
      });
    } catch (e) {
      logger.debug({ err: (e as Error).message, uni: u.id }, 'upsertUniversity failed');
    }
  },

  async findUniversityByName(name: string): Promise<string | null> {
    const r = await getClient().execute({
      sql: `SELECT id FROM universities
            WHERE LOWER(name) LIKE ? OR LOWER(COALESCE(short_name, '')) LIKE ?
            LIMIT 1`,
      args: [`%${name.toLowerCase()}%`, `%${name.toLowerCase()}%`],
    });
    return (r.rows[0] as { id: string } | undefined)?.id ?? null;
  },
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function rowToOpportunity(row: Record<string, unknown>): Opportunity {
  return {
    id: String(row.id),
    externalId: String(row.external_id),
    source: String(row.source),
    title: String(row.title),
    provider: String(row.provider),
    url: String(row.official_url),
    description: (row.description as string) ?? undefined,
    fields: safeJsonArray(row.fields),
    countries: safeJsonArray(row.countries),
    degreeLevels: safeJsonArray(row.degree_levels) as Opportunity['degreeLevels'],
    funding: {
      kind: (row.funding_kind as Opportunity['funding']['kind']) ?? 'unknown',
      amount: (row.funding_amount as number) ?? undefined,
      currency: (row.funding_currency as string) ?? undefined,
    },
    deadline: row.deadline ? new Date(Number(row.deadline) * 1000).toISOString() : undefined,
    ieltsRequired: !!row.ielts_required,
    gpaMin: (row.gpa_min as number) ?? undefined,
    status: (row.status as Opportunity['status']) ?? 'pending',
    lastSeenAt: Number(row.last_seen_at ?? Date.now() / 1000),
    rawPayload: (row.raw_payload as string) ?? undefined,
  };
}

function safeJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
