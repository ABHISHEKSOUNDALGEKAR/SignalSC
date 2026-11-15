import { z } from 'zod';
import {
  importHealthOutcomes,
  type FeedImportFailureCategory, type FeedImportHealth, type ImportHealthOutcome,
  type ImportHealthResponse, type ImportHealthRun,
} from '../shared/api';
import { modelConfigured } from './model';
import type { Store } from './store';

type Source = ImportHealthRun['source'];
const key = (source: Source) => `import-health:v1:${source}`;
const feedKey = (source: Source) => `feed-import-health:v1:${source}`;
const stamp = z.string().datetime();
const snapshotSchema = z.object({
  checkedAt: stamp,
  lastSuccessAt: stamp.nullable(),
  buckets: z.array(z.object({
    outcome: z.enum(importHealthOutcomes),
    count: z.number().int().positive(),
    // null means no retry is appropriate; 0 means eligible at the next import.
    retryAt: z.number().finite().nonnegative().nullable(),
  })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

const FEED_FRESH_MS = 2 * 60 * 60_000;
const feedSnapshotSchema = z.object({
  checkedAt: stamp,
  lastCompletedAt: stamp.nullable(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  lastFailureCategory: z.enum(['request_failed', 'invalid_feed', 'event_save_failed']).nullable().default(null),
  fetch: z.object({
    status: z.enum(['pending', 'succeeded', 'failed']),
    failureCategory: z.enum(['request_failed', 'invalid_feed']).nullable(),
  }),
  eventSave: z.object({
    status: z.enum(['pending', 'succeeded', 'failed', 'not_attempted']),
    failureCategory: z.literal('event_save_failed').nullable(),
  }),
});
type FeedSnapshot = z.infer<typeof feedSnapshotSchema>;

// Fixed keys, aggregate counts only. Never store source text, URLs, cache hashes,
// provider error bodies, or credentials in this operator-facing metadata.
export function importHealthRecorder(store: Store, source: Source, now: Date) {
  const buckets: Snapshot['buckets'] = [];
  let lastSuccessAt: string | null = null;
  return {
    add(outcome: ImportHealthOutcome, count: number, retryAt: number | null = null) {
      if (!count) return;
      const bucket = buckets.find(b => b.outcome === outcome && b.retryAt === retryAt);
      if (bucket) bucket.count += count;
      else buckets.push({ outcome, count, retryAt });
    },
    success(at: number | null) {
      if (at !== null) {
        const stamp = new Date(at).toISOString();
        if (!lastSuccessAt || stamp > lastSuccessAt) lastSuccessAt = stamp;
      }
    },
    async save() {
      try {
        // CAS prevents an older overlapping importer from replacing a newer run.
        for (let attempt = 0; attempt < 3; attempt++) {
          const previous = await store.getMetaSnapshot(key(source));
          let decoded: unknown = null;
          try { decoded = previous.value ? JSON.parse(previous.value) : null; } catch { /* Replace corrupt summaries on the next completed pass. */ }
          const parsed = snapshotSchema.safeParse(decoded);
          if (parsed.success && parsed.data.checkedAt > now.toISOString()) return;
          const priorSuccess = parsed.success ? parsed.data.lastSuccessAt : null;
          const value: Snapshot = { checkedAt: now.toISOString(), buckets,
            lastSuccessAt: [priorSuccess, lastSuccessAt].filter((s): s is string => s !== null).sort().at(-1) ?? null };
          if (await store.compareMeta(key(source), previous.value, JSON.stringify(value))) return;
        }
        console.warn('Import health summary could not be saved.');
      } catch {
        console.warn('Import health summary unavailable.');
      }
    },
  };
}

// Feed availability and event persistence are tracked independently from the
// optional AI detail-recovery pass above. Only fixed safe categories are stored.
export function feedImportHealthRecorder(store: Store, source: Source, now: Date) {
  const snapshot: FeedSnapshot = {
    checkedAt: now.toISOString(),
    lastCompletedAt: null,
    consecutiveFailures: 0,
    lastFailureCategory: null,
    fetch: { status: 'pending', failureCategory: null },
    eventSave: { status: 'not_attempted', failureCategory: null },
  };
  return {
    fetchSucceeded() {
      snapshot.fetch = { status: 'succeeded', failureCategory: null };
      snapshot.eventSave = { status: 'pending', failureCategory: null };
    },
    fetchFailed(category: Extract<FeedImportFailureCategory, 'request_failed' | 'invalid_feed'>) {
      snapshot.fetch = { status: 'failed', failureCategory: category };
      snapshot.lastFailureCategory = category;
    },
    saveFailed() {
      snapshot.eventSave = { status: 'failed', failureCategory: 'event_save_failed' };
      snapshot.lastFailureCategory = 'event_save_failed';
    },
    completed() {
      snapshot.eventSave = { status: 'succeeded', failureCategory: null };
      snapshot.lastCompletedAt = snapshot.checkedAt;
      snapshot.consecutiveFailures = 0;
      snapshot.lastFailureCategory = null;
    },
    async save() {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const previous = await store.getMetaSnapshot(feedKey(source));
          let decoded: unknown = null;
          try { decoded = previous.value ? JSON.parse(previous.value) : null; } catch { /* Replaced by the next import attempt. */ }
          const parsed = feedSnapshotSchema.safeParse(decoded);
          if (parsed.success && parsed.data.checkedAt > snapshot.checkedAt) return;
          const priorCompletion = parsed.success ? parsed.data.lastCompletedAt : null;
          const completedAt = [priorCompletion, snapshot.lastCompletedAt]
            .filter((value): value is string => value !== null).sort().at(-1) ?? null;
          const sameAttemptAlreadyFailed = parsed.success && parsed.data.checkedAt === snapshot.checkedAt
            && (parsed.data.fetch.status === 'failed' || parsed.data.eventSave.status === 'failed');
          const value: FeedSnapshot = {
            ...snapshot,
            lastCompletedAt: completedAt,
            consecutiveFailures: snapshot.lastCompletedAt ? 0
              : snapshot.lastFailureCategory
                ? parsed.success ? parsed.data.consecutiveFailures + (sameAttemptAlreadyFailed ? 0 : 1) : 1
                : parsed.success ? parsed.data.consecutiveFailures : 0,
          };
          if (await store.compareMeta(feedKey(source), previous.value, JSON.stringify(value))) return;
        }
        console.warn('Feed import health summary could not be saved.');
      } catch {
        console.warn('Feed import health summary unavailable.');
      }
    },
  };
}

export async function readImportHealth(store: Store, now = Date.now()): Promise<ImportHealthResponse> {
  const runs: ImportHealthRun[] = [];
  const feedImports: FeedImportHealth[] = [];
  for (const source of ['engagesc', 'usc-calendar'] as const) {
    const raw = await store.getMeta(key(source));
    if (raw) {
      // Corrupt metadata is an explicit unavailable response, not a healthy zero.
      const snapshot = snapshotSchema.parse(JSON.parse(raw));
      const outcomes = importHealthOutcomes.flatMap(outcome => {
        const buckets = snapshot.buckets.filter(b => b.outcome === outcome);
        if (!buckets.length) return [];
        const future = buckets.flatMap(b => b.retryAt !== null && b.retryAt > now ? [b.retryAt] : []);
        return [{ outcome, count: buckets.reduce((n, b) => n + b.count, 0),
          retryEligible: modelConfigured ? buckets.reduce((n, b) => n + (b.retryAt !== null && b.retryAt <= now ? b.count : 0), 0) : 0,
          nextRetryAt: future.length ? new Date(Math.min(...future)).toISOString() : null }];
      });
      runs.push({ source, checkedAt: snapshot.checkedAt, lastSuccessAt: snapshot.lastSuccessAt,
        eventCount: outcomes.reduce((n, b) => n + b.count, 0), outcomes });
    }
    const feedRaw = await store.getMeta(feedKey(source));
    if (feedRaw) {
      const snapshot = feedSnapshotSchema.parse(JSON.parse(feedRaw));
      const age = snapshot.lastCompletedAt ? now - Date.parse(snapshot.lastCompletedAt) : null;
      feedImports.push({
        source,
        lastAttemptAt: snapshot.checkedAt,
        lastCompletedAt: snapshot.lastCompletedAt,
        freshness: age === null ? 'never' : age <= FEED_FRESH_MS ? 'fresh' : 'stale',
        consecutiveFailures: snapshot.consecutiveFailures,
        lastFailureCategory: snapshot.lastFailureCategory,
        fetch: snapshot.fetch,
        eventSave: snapshot.eventSave,
      });
    }
  }
  return { modelConfigured, runs, feedImports };
}
