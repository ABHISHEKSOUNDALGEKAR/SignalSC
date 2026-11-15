import { z } from 'zod';
import { importHealthOutcomes, type ImportHealthOutcome, type ImportHealthResponse, type ImportHealthRun } from '../shared/api';
import { modelConfigured } from './model';
import type { Store } from './store';

type Source = ImportHealthRun['source'];
const key = (source: Source) => `import-health:v1:${source}`;
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

export async function readImportHealth(store: Store, now = Date.now()): Promise<ImportHealthResponse> {
  const runs: ImportHealthRun[] = [];
  for (const source of ['engagesc', 'usc-calendar'] as const) {
    const raw = await store.getMeta(key(source));
    if (!raw) continue;
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
  return { modelConfigured, runs };
}
