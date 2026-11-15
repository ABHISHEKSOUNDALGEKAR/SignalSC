import { z } from 'zod';
import type { Store, StoredEvent } from './store';

const ENDPOINT = 'https://engage.usc.edu/api/v2/graphql';
const CACHE_MS = 6 * 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const MAX_BATCH = 20;
const detailSchema = z.object({
  id: z.string(),
  name: z.string().max(1000),
  isFoodIncluded: z.boolean().nullable(),
  foodDetails: z.string().max(10_000).nullable(),
});
type Detail = z.infer<typeof detailSchema>;
const cacheSchema = z.object({ checkedAt: z.number(), detail: detailSchema.nullable(), unavailable: z.boolean().optional() });
const pending = new WeakMap<Store, Map<string, Promise<StoredEvent>>>();

export function engageScEventId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'engage.usc.edu' || url.port || url.username || url.password) return null;
    if (!/^\/(?:[a-z0-9_-]+\/)?rsvp(?:_boot)?\/?$/i.test(url.pathname)) return null;
    const id = url.searchParams.get('id');
    return id && /^\d{1,16}$/.test(id) ? id : null;
  } catch { return null; }
}

function applyDetail(record: StoredEvent, detail: Detail | null): StoredEvent {
  if (!detail?.isFoodIncluded) return record;
  if (record.data.food === 'not-advertised' ||
      record.data.uncertainties.some(note => /conflicting or ambiguous food|calendar description and public food details disagree/i.test(note))) {
    return {
      ...record,
      data: { ...record.data, food: 'unknown',
        evidence: record.data.evidence.filter(item => item.field !== 'food'),
        uncertainties: [...new Set([...record.data.uncertainties,
          'Calendar description and public food details disagree; food left unknown.'])] },
    };
  }
  // The public site's "Food Provided" section is controlled by isFoodIncluded.
  // Its absence does not establish that no food is offered.
  const evidence = {
    field: 'food',
    excerpt: `EngageSC: Food Provided${detail.foodDetails ? ` — ${detail.foodDetails.replace(/\s+/g, ' ').trim()}` : ''}`.slice(0, 300),
  };
  const otherEvidence = record.data.evidence.filter(item => item.field !== 'food');
  return {
    ...record,
    data: { ...record.data, food: 'advertised', evidence: [...otherEvidence, evidence] },
  };
}

// Read only the same public food fields used by EngageSC's event page.
// No sign-in, private fields, arbitrary URLs, or provider credits are needed.
export async function enrichEngageScFood(store: Store, records: StoredEvent[], now = new Date(), prefetchUpcomingOnly = false): Promise<StoredEvent[]> {
  const output = [...records];
  const missing: { index: number; id: string; previous: Detail | null }[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.extractedBy !== 'import' || record.data.sourceKind !== 'engagesc') continue;
    const id = engageScEventId(record.data.sourceUrl);
    if (!id) continue;
    const canFetch = !prefetchUpcomingOnly || Date.parse(record.data.endsAt ?? record.data.startsAt ?? '') >= now.getTime();
    let cached: z.infer<typeof cacheSchema> | null = null;
    try {
      const raw = await store.getMeta(`engagesc-food:v1:${id}`);
      if (raw) {
        const parsed = cacheSchema.safeParse(JSON.parse(raw));
        if (parsed.success) cached = parsed.data;
      }
    } catch { /* An invalid cache entry must not prevent a fresh source check. */ }
    if (cached && (!canFetch || now.getTime() - cached.checkedAt < (cached.detail && !cached.unavailable ? CACHE_MS : RETRY_MS))) {
      output[index] = applyDetail(record, cached.detail);
    } else if (canFetch) missing.push({ index, id, previous: cached?.detail ?? null });
  }
  for (let offset = 0; offset < missing.length; offset += MAX_BATCH) {
    const batch = missing.slice(offset, offset + MAX_BATCH);
    const fields = batch.map(({ id }, index) =>
      `e${index}: event(id: "${Buffer.from(`usc:Event:${id}`).toString('base64')}") { id name isFoodIncluded foodDetails }`).join('\n');
    let details: Record<string, unknown> = {};
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: `query SignalSCPublicFood { ${fields} }` }),
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Public details unavailable.');
      const body = z.object({ data: z.record(z.string(), z.unknown()).nullable().optional() }).parse(await response.json());
      details = body.data ?? {};
    } catch {
      console.warn('EngageSC public food details are temporarily unavailable; preserving existing source facts.');
    }
    for (const [index, item] of batch.entries()) {
      const parsed = detailSchema.safeParse(details[`e${index}`]);
      const expectedId = Buffer.from(`usc:Event:${item.id}`).toString('base64');
      const valid = parsed.success && parsed.data.id === expectedId;
      const detail = valid ? parsed.data : item.previous;
      await store.setMeta(`engagesc-food:v1:${item.id}`, JSON.stringify({ checkedAt: now.getTime(), detail, unavailable: !valid }));
      output[item.index] = applyDetail(records[item.index], detail);
    }
  }
  return output;
}

// Deduplicate concurrent event-page reads and retain the record's original ID/feedback.
export async function refreshEventFood(store: Store, record: StoredEvent): Promise<StoredEvent> {
  if (record.extractedBy !== 'import' || record.data.sourceKind !== 'engagesc') return record;
  let requests = pending.get(store);
  if (!requests) { requests = new Map(); pending.set(store, requests); }
  const existing = requests.get(record.id);
  if (existing) return existing;
  const task = (async () => {
    const [enriched] = await enrichEngageScFood(store, [record]);
    if (JSON.stringify(enriched.data) === JSON.stringify(record.data)) return record;
    const latest = await store.get(record.id);
    if (!latest || latest.extractedBy !== 'import' || latest.externalId !== record.externalId) return latest ?? record;
    const updated = {
      ...latest,
      data: {
        ...latest.data, food: enriched.data.food,
        evidence: [...latest.data.evidence.filter(item => item.field !== 'food'), ...enriched.data.evidence.filter(item => item.field === 'food')],
      },
      updatedAt: new Date().toISOString(),
    };
    await store.update(updated);
    return updated;
  })().finally(() => requests!.delete(record.id));
  requests.set(record.id, task);
  return task;
}
