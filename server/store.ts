import pg from 'pg';
import type { EventDraft } from '../shared/events';
import { isProduction } from './env';

export type StoredStatus = 'draft' | 'published' | 'cancelled';

export type StoredEvent = {
  id: string;
  status: StoredStatus;
  organizationId: string | null; // null for imported records
  organizationName: string | null;
  data: EventDraft;
  flyerId: string | null;
  extractedBy: 'model' | 'manual' | 'import';
  confirmation: 'organizer-confirmed' | 'source-imported' | null;
  externalId: string | null; // source id for imported records, used to deduplicate
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  suggestions?: string[]; // listing suggestions from flyer review, shown on the draft only
};

export type Flyer = { mimeType: string; bytes: Buffer };
export type UpsertResult = 'inserted' | 'updated' | 'unchanged';
export type StoredFeedback = {
  id: string;
  eventId: string;
  rating: number;
  wouldReturn: boolean | null;
  comment: string;
  deviceKey: string;
  demo: boolean;
  createdAt: string;
};

export interface CoordinationStore {
  // PostgreSQL supplies its own clock so replica clock skew cannot reset limits.
  getMetaSnapshot(key: string, now?: number): Promise<{ value: string | null; now: number }>;
  compareMeta(key: string, expected: string | null, value: string, validUntil?: number): Promise<boolean>;
}

export interface Store extends CoordinationStore {
  readonly mode: 'live' | 'memory';
  init(): Promise<void>;
  close?(): Promise<void>;
  insert(record: StoredEvent): Promise<void>;
  update(record: StoredEvent): Promise<void>;
  get(id: string): Promise<StoredEvent | null>;
  list(filter: { statuses: StoredStatus[]; organizationId?: string }): Promise<StoredEvent[]>;
  // Insert or refresh an imported record by externalId. Keeps the existing id and timestamps,
  // and leaves the record untouched when the source has not changed.
  upsertImported(record: StoredEvent): Promise<UpsertResult>;
  saveFlyer(id: string, flyer: Flyer): Promise<void>;
  getFlyer(id: string): Promise<Flyer | null>;
  addFeedback(entry: StoredFeedback): Promise<boolean>;
  listFeedback(eventId: string): Promise<StoredFeedback[]>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  pruneImportEnrichmentCache(retentionMs: number, limit: number): Promise<number>;
}

const sameSource = (a: StoredEvent, b: StoredEvent) =>
  JSON.stringify(a.data) === JSON.stringify(b.data) && a.organizationName === b.organizationName;

export class MemoryStore implements Store {
  readonly mode = 'memory' as const;
  constructor(private readonly clock = Date.now) {}
  private events = new Map<string, StoredEvent>();
  private flyers = new Map<string, Flyer>();
  private feedback = new Map<string, StoredFeedback>();
  private meta = new Map<string, string>();
  async init() {}
  async insert(record: StoredEvent) { this.events.set(record.id, structuredClone(record)); }
  async update(record: StoredEvent) { this.events.set(record.id, structuredClone(record)); }
  async get(id: string) { const r = this.events.get(id); return r ? structuredClone(r) : null; }
  async list(filter: { statuses: StoredStatus[]; organizationId?: string }) {
    return [...this.events.values()]
      .filter(r => filter.statuses.includes(r.status) && (!filter.organizationId || r.organizationId === filter.organizationId))
      .map(r => structuredClone(r));
  }
  async upsertImported(record: StoredEvent): Promise<UpsertResult> {
    const existing = [...this.events.values()].find(r => r.externalId === record.externalId);
    if (!existing) { this.events.set(record.id, structuredClone(record)); return 'inserted'; }
    if (sameSource(existing, record)) return 'unchanged';
    this.events.set(existing.id, { ...structuredClone(record), id: existing.id, createdAt: existing.createdAt, publishedAt: existing.publishedAt });
    return 'updated';
  }
  async saveFlyer(id: string, flyer: Flyer) { this.flyers.set(id, flyer); }
  async getFlyer(id: string) { return this.flyers.get(id) ?? null; }
  async addFeedback(entry: StoredFeedback) {
    if ([...this.feedback.values()].some(item => item.eventId === entry.eventId && item.deviceKey === entry.deviceKey)) return false;
    this.feedback.set(entry.id, structuredClone(entry));
    return true;
  }
  async listFeedback(eventId: string) {
    return [...this.feedback.values()]
      .filter(item => item.eventId === eventId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(item => structuredClone(item));
  }
  async getMeta(key: string) { return this.meta.get(key) ?? null; }
  async setMeta(key: string, value: string) { this.meta.set(key, value); }
  async pruneImportEnrichmentCache(retentionMs: number, limit: number) {
    const now = this.clock();
    let removed = 0;
    for (const [key, value] of this.meta) {
      if (removed >= limit || !key.startsWith('import-details:')) continue;
      let entry: { successAt?: unknown; retryAt?: unknown; until?: unknown };
      try { entry = JSON.parse(value); }
      catch { continue; }
      const time = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : 0;
      const safe = time(entry.until) <= now && time(entry.retryAt) <= now;
      const stale = value === '{}' || (typeof entry.successAt === 'number' && entry.successAt < now - retentionMs) ||
        (typeof entry.retryAt === 'number' && entry.retryAt <= now) ||
        (typeof entry.until === 'number' && entry.until <= now);
      if (safe && stale) { this.meta.delete(key); removed++; }
    }
    return removed;
  }
  async getMetaSnapshot(key: string, now = this.clock()) { return { value: this.meta.get(key) ?? null, now }; }
  async compareMeta(key: string, expected: string | null, value: string, validUntil?: number) {
    if ((this.meta.get(key) ?? null) !== expected || (validUntil !== undefined && this.clock() >= validUntil)) return false;
    this.meta.set(key, value);
    return true;
  }
}

// The subset of pg.Pool the store needs.
export type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; end?: () => Promise<void> };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ts_events (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     organization_id TEXT,
     external_id TEXT UNIQUE,
     record JSONB NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS ts_events_status_idx ON ts_events (status)',
  'CREATE INDEX IF NOT EXISTS ts_events_org_idx ON ts_events (organization_id)',
  `CREATE TABLE IF NOT EXISTS ts_flyers (
     id TEXT PRIMARY KEY,
     mime_type TEXT NOT NULL,
     bytes BYTEA NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ts_feedback (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      would_return BOOLEAN,
      comment TEXT NOT NULL,
      device_key TEXT NOT NULL,
      demo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, device_key)
    )`,
  'CREATE INDEX IF NOT EXISTS ts_feedback_event_idx ON ts_feedback (event_id)',
  'CREATE TABLE IF NOT EXISTS ts_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

export class PostgresStore implements Store {
  readonly mode = 'live' as const;
  constructor(private db: Queryable) {}
  private async rows<T>(sql: string, params?: unknown[]) { return (await this.db.query(sql, params)).rows as T[]; }

  async init() { for (const statement of SCHEMA) await this.db.query(statement); }
  async close() { await this.db.end?.(); }
  async insert(r: StoredEvent) {
    await this.db.query(
      'INSERT INTO ts_events (id, status, organization_id, external_id, record, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)',
      [r.id, r.status, r.organizationId, r.externalId, JSON.stringify(r), r.updatedAt]);
  }
  async update(r: StoredEvent) {
    await this.db.query(
      'UPDATE ts_events SET status=$2, organization_id=$3, external_id=$4, record=$5::jsonb, updated_at=$6 WHERE id=$1',
      [r.id, r.status, r.organizationId, r.externalId, JSON.stringify(r), r.updatedAt]);
  }
  async get(id: string) {
    const rows = await this.rows<{ record: StoredEvent }>('SELECT record FROM ts_events WHERE id=$1', [id]);
    return rows[0]?.record ?? null;
  }
  async list(filter: { statuses: StoredStatus[]; organizationId?: string }) {
    const params: unknown[] = [filter.statuses];
    let sql = 'SELECT record FROM ts_events WHERE status = ANY($1::text[])';
    if (filter.organizationId) { params.push(filter.organizationId); sql += ' AND organization_id = $2'; }
    return (await this.rows<{ record: StoredEvent }>(sql, params)).map(r => r.record);
  }
  async upsertImported(r: StoredEvent): Promise<UpsertResult> {
    // One statement so concurrent imports cannot create duplicates.
    const rows = await this.rows<{ inserted: boolean }>(
      `INSERT INTO ts_events (id, status, organization_id, external_id, record, updated_at)
       VALUES ($1,$2,NULL,$3,$4::jsonb,$5)
       ON CONFLICT (external_id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         record = EXCLUDED.record || jsonb_build_object(
           'id', ts_events.id, 'createdAt', ts_events.record->'createdAt', 'publishedAt', ts_events.record->'publishedAt')
       WHERE ts_events.record->'data' IS DISTINCT FROM EXCLUDED.record->'data'
          OR ts_events.record->'organizationName' IS DISTINCT FROM EXCLUDED.record->'organizationName'
       RETURNING (xmax = 0) AS inserted`,
      [r.id, r.status, r.externalId, JSON.stringify(r), r.updatedAt]);
    if (!rows.length) return 'unchanged';
    return rows[0].inserted ? 'inserted' : 'updated';
  }
  async saveFlyer(id: string, flyer: Flyer) {
    await this.db.query('INSERT INTO ts_flyers (id, mime_type, bytes) VALUES ($1,$2,$3)', [id, flyer.mimeType, flyer.bytes]);
  }
  async getFlyer(id: string) {
    const rows = await this.rows<{ mime_type: string; bytes: Uint8Array }>('SELECT mime_type, bytes FROM ts_flyers WHERE id=$1', [id]);
    return rows[0] ? { mimeType: rows[0].mime_type, bytes: Buffer.from(rows[0].bytes) } : null;
  }
  async addFeedback(entry: StoredFeedback) {
    const rows = await this.rows<{ id: string }>(
      `INSERT INTO ts_feedback (id, event_id, rating, would_return, comment, device_key, demo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (event_id, device_key) DO NOTHING
       RETURNING id`,
      [entry.id, entry.eventId, entry.rating, entry.wouldReturn, entry.comment, entry.deviceKey, entry.demo, entry.createdAt],
    );
    return rows.length > 0;
  }
  async listFeedback(eventId: string) {
    const rows = await this.rows<{
      id: string;
      event_id: string;
      rating: number;
      would_return: boolean | null;
      comment: string;
      device_key: string;
      demo: boolean;
      created_at: Date | string;
    }>('SELECT id, event_id, rating, would_return, comment, device_key, demo, created_at FROM ts_feedback WHERE event_id=$1 ORDER BY created_at ASC', [eventId]);
    return rows.map(row => ({
      id: row.id,
      eventId: row.event_id,
      rating: row.rating,
      wouldReturn: row.would_return,
      comment: row.comment,
      deviceKey: row.device_key,
      demo: row.demo,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    }));
  }
  async getMeta(key: string) {
    const rows = await this.rows<{ value: string }>('SELECT value FROM ts_meta WHERE key=$1', [key]);
    return rows[0]?.value ?? null;
  }
  async setMeta(key: string, value: string) {
    await this.db.query('INSERT INTO ts_meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  }
  async pruneImportEnrichmentCache(retentionMs: number, limit: number) {
    const result = await this.rows<{ key: string }>(
      `WITH candidates AS (
         SELECT key
         FROM ts_meta
         WHERE key LIKE 'import-details:%'
           AND CASE WHEN value ~ '"until"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
             THEN substring(value FROM '"until"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric ELSE 0 END
               <= floor(extract(epoch FROM clock_timestamp()) * 1000)
           AND CASE WHEN value ~ '"retryAt"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
             THEN substring(value FROM '"retryAt"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric ELSE 0 END
               <= floor(extract(epoch FROM clock_timestamp()) * 1000)
           AND (
             value = '{}'
             OR (value ~ '"successAt"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
               AND substring(value FROM '"successAt"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric
                 < floor(extract(epoch FROM clock_timestamp()) * 1000) - $1)
             OR (value ~ '"retryAt"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
               AND substring(value FROM '"retryAt"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric
                 <= floor(extract(epoch FROM clock_timestamp()) * 1000))
             OR (value ~ '"until"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
               AND substring(value FROM '"until"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric
                 <= floor(extract(epoch FROM clock_timestamp()) * 1000))
           )
         ORDER BY CASE WHEN value ~ '"successAt"[[:space:]]*:[[:space:]]*[0-9]{1,16}'
           THEN substring(value FROM '"successAt"[[:space:]]*:[[:space:]]*([0-9]{1,16})')::numeric ELSE 0 END
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ts_meta AS meta
       USING candidates
       WHERE meta.key = candidates.key
       RETURNING meta.key`,
      [retentionMs, limit],
    );
    return result.length;
  }
  async getMetaSnapshot(key: string) {
    const [row] = await this.rows<{ value: string | null; now: number }>(
      `SELECT (SELECT value FROM ts_meta WHERE key=$1) AS value,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now`, [key]);
    return row;
  }
  async compareMeta(key: string, expected: string | null, value: string, validUntil?: number) {
    const result = expected === null
      ? await this.rows(`INSERT INTO ts_meta (key,value) SELECT $1,$2
          WHERE ($3::float8 IS NULL OR extract(epoch FROM clock_timestamp()) * 1000 < $3)
          ON CONFLICT (key) DO NOTHING RETURNING key`, [key, value, validUntil ?? null])
      : await this.rows(`UPDATE ts_meta SET value=$3 WHERE key=$1 AND value=$2
          AND ($4::float8 IS NULL OR extract(epoch FROM clock_timestamp()) * 1000 < $4)
          RETURNING key`, [key, expected, value, validUntil ?? null]);
    return result.length === 1;
  }
}

export function createStore(): Store {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresStore(new pg.Pool({
    connectionString: url, max: 5, connectionTimeoutMillis: 2000,
    statement_timeout: 5000, lock_timeout: 1000, allowExitOnIdle: true,
  }));
  if (isProduction) throw new Error('DATABASE_URL is required in production.');
  console.warn('DATABASE_URL not set: using in-memory store (data resets on restart).');
  return new MemoryStore();
}
