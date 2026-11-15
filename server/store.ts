import pg from 'pg';
import type { EventDraft } from '../shared/events';

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
};

export type Flyer = { mimeType: string; bytes: Buffer };

export interface Store {
  readonly mode: 'live' | 'memory';
  init(): Promise<void>;
  insert(record: StoredEvent): Promise<void>;
  update(record: StoredEvent): Promise<void>;
  get(id: string): Promise<StoredEvent | null>;
  list(filter: { statuses: StoredStatus[]; organizationId?: string }): Promise<StoredEvent[]>;
  // Insert or refresh an imported record by externalId; never touches organizer-owned records.
  upsertImported(record: StoredEvent): Promise<'inserted' | 'updated'>;
  saveFlyer(id: string, flyer: Flyer): Promise<void>;
  getFlyer(id: string): Promise<Flyer | null>;
}

class MemoryStore implements Store {
  readonly mode = 'memory' as const;
  private events = new Map<string, StoredEvent>();
  private flyers = new Map<string, Flyer>();
  async init() {}
  async insert(record: StoredEvent) { this.events.set(record.id, structuredClone(record)); }
  async update(record: StoredEvent) { this.events.set(record.id, structuredClone(record)); }
  async get(id: string) { const r = this.events.get(id); return r ? structuredClone(r) : null; }
  async list(filter: { statuses: StoredStatus[]; organizationId?: string }) {
    return [...this.events.values()]
      .filter(r => filter.statuses.includes(r.status) && (!filter.organizationId || r.organizationId === filter.organizationId))
      .map(r => structuredClone(r));
  }
  async upsertImported(record: StoredEvent) {
    const existing = [...this.events.values()].find(r => r.externalId === record.externalId);
    if (existing) {
      this.events.set(existing.id, { ...structuredClone(record), id: existing.id, createdAt: existing.createdAt });
      return 'updated' as const;
    }
    this.events.set(record.id, structuredClone(record));
    return 'inserted' as const;
  }
  async saveFlyer(id: string, flyer: Flyer) { this.flyers.set(id, flyer); }
  async getFlyer(id: string) { return this.flyers.get(id) ?? null; }
}

class PostgresStore implements Store {
  readonly mode = 'live' as const;
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ts_events (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        organization_id TEXT,
        external_id TEXT UNIQUE,
        record JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ts_events_status_idx ON ts_events (status);
      CREATE INDEX IF NOT EXISTS ts_events_org_idx ON ts_events (organization_id);
      CREATE TABLE IF NOT EXISTS ts_flyers (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        bytes BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
  }
  async insert(r: StoredEvent) {
    await this.pool.query(
      'INSERT INTO ts_events (id, status, organization_id, external_id, record, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [r.id, r.status, r.organizationId, r.externalId, r, r.updatedAt]);
  }
  async update(r: StoredEvent) {
    await this.pool.query(
      'UPDATE ts_events SET status=$2, organization_id=$3, external_id=$4, record=$5, updated_at=$6 WHERE id=$1',
      [r.id, r.status, r.organizationId, r.externalId, r, r.updatedAt]);
  }
  async get(id: string) {
    const { rows } = await this.pool.query<{ record: StoredEvent }>('SELECT record FROM ts_events WHERE id=$1', [id]);
    return rows[0]?.record ?? null;
  }
  async list(filter: { statuses: StoredStatus[]; organizationId?: string }) {
    const params: unknown[] = [filter.statuses];
    let sql = 'SELECT record FROM ts_events WHERE status = ANY($1)';
    if (filter.organizationId) { params.push(filter.organizationId); sql += ' AND organization_id = $2'; }
    const { rows } = await this.pool.query<{ record: StoredEvent }>(sql, params);
    return rows.map(r => r.record);
  }
  async upsertImported(r: StoredEvent) {
    const { rows } = await this.pool.query<{ id: string; record: StoredEvent }>(
      'SELECT id, record FROM ts_events WHERE external_id=$1', [r.externalId]);
    if (rows[0]) {
      await this.update({ ...r, id: rows[0].id, createdAt: rows[0].record.createdAt });
      return 'updated' as const;
    }
    await this.insert(r);
    return 'inserted' as const;
  }
  async saveFlyer(id: string, flyer: Flyer) {
    await this.pool.query('INSERT INTO ts_flyers (id, mime_type, bytes) VALUES ($1,$2,$3)', [id, flyer.mimeType, flyer.bytes]);
  }
  async getFlyer(id: string) {
    const { rows } = await this.pool.query<{ mime_type: string; bytes: Buffer }>('SELECT mime_type, bytes FROM ts_flyers WHERE id=$1', [id]);
    return rows[0] ? { mimeType: rows[0].mime_type, bytes: rows[0].bytes } : null;
  }
}

export function createStore(): Store {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresStore(url);
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production.');
  console.warn('DATABASE_URL not set: using in-memory store (data resets on restart).');
  return new MemoryStore();
}
