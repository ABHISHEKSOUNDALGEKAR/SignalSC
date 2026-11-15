import { randomUUID } from 'node:crypto';
import type { CoordinationStore } from './store';

export const IMPORT_LEASE_MS = 60_000;
const RETRY_MS = 24 * 60 * 60 * 1000;
type Entry = { details?: unknown; retryAt?: number; token?: string; until?: number };
export type CacheClaim =
  | { kind: 'cached'; details: unknown }
  | { kind: 'busy' }
  | { kind: 'owned'; beforeAttempt(): Promise<boolean>; finish(details?: unknown): Promise<boolean>; cancel(): Promise<boolean> };

// A lease covers only one imminent batch, not the entire import. A pre-send
// crash is recoverable after a minute; a possibly charged attempt keeps the
// existing 24-hour cooldown even after its worker dies.
export async function claimImportCache(store: CoordinationStore, key: string, now?: number): Promise<CacheClaim> {
  const snapshot = await store.getMetaSnapshot(key, now);
  let entry: Entry = {};
  try { entry = JSON.parse(snapshot.value ?? '{}') ?? {}; }
  catch { /* Invalid legacy entry may be replaced atomically. */ }
  if (entry.details) return { kind: 'cached', details: entry.details };
  if ((entry.until ?? 0) > snapshot.now || (entry.retryAt ?? 0) > snapshot.now) return { kind: 'busy' };
  const until = snapshot.now + IMPORT_LEASE_MS;
  let expected = JSON.stringify({ token: randomUUID(), until });
  if (!await store.compareMeta(key, snapshot.value, expected, until)) return { kind: 'busy' };
  let attempted = false;
  const replace = async (value: string) => {
    const changed = await store.compareMeta(key, expected, value, until);
    if (changed) expected = value;
    return changed;
  };
  return {
    kind: 'owned',
    beforeAttempt: async () => {
      const value = JSON.stringify({ ...JSON.parse(expected), retryAt: snapshot.now + RETRY_MS });
      if (!await replace(value)) return false;
      attempted = true;
      return true;
    },
    finish: async details => replace(JSON.stringify(details === undefined
      ? { retryAt: snapshot.now + RETRY_MS } : { details })),
    cancel: async () => attempted ? false : replace('{}'),
  };
}
