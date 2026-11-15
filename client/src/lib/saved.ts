import type { EventRecord } from '../../../shared/api';
import { ApiError, getEvent } from './api';

export const savedKey = 'trojan-signal:saved-event-ids:v1';
type SavedStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type SavedSnapshot = { ids: readonly string[]; persisted: boolean; pending: boolean; issue: 'read' | 'write' | 'malformed' | null };
const isId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0;

export function parseSavedIds(raw: string | null): { ids: string[]; malformed: boolean } {
  if (raw === null) return { ids: [], malformed: false };
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return { ids: [], malformed: true };
    const ids = [...new Set(data.filter(isId))];
    return { ids, malformed: ids.length !== data.length };
  } catch { return { ids: [], malformed: true }; }
}

/** Persist IDs only. Pending operations survive read/write failures within this tab. */
export function createSavedStore(access: () => SavedStorage) {
  const listeners = new Set<() => void>();
  const pending = new Map<string, boolean>();
  let snapshot: SavedSnapshot = { ids: [], persisted: false, pending: false, issue: 'read' };
  function update(next: SavedSnapshot) {
    if (snapshot.persisted === next.persisted && snapshot.pending === next.pending && snapshot.issue === next.issue && snapshot.ids.length === next.ids.length && snapshot.ids.every((id, index) => id === next.ids[index])) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  function applyPending(ids: readonly string[]) {
    const result = new Set(ids);
    pending.forEach((saved, id) => saved ? result.add(id) : result.delete(id));
    return [...result];
  }
  function refresh() {
    try {
      const parsed = parseSavedIds(access().getItem(savedKey));
      update({ ids: applyPending(parsed.ids), pending: pending.size > 0, persisted: pending.size === 0, issue: pending.size ? 'write' : parsed.malformed ? 'malformed' : null });
    } catch { update({ ...snapshot, persisted: false, pending: pending.size > 0, issue: 'read' }); }
  }
  function persist() {
    if (!pending.size) { refresh(); return; }
    let storage: SavedStorage;
    let ids: string[];
    try { storage = access(); ids = applyPending(parseSavedIds(storage.getItem(savedKey)).ids); }
    catch { update({ ...snapshot, persisted: false, pending: true, issue: 'read' }); return; }
    try {
      storage.setItem(savedKey, JSON.stringify(ids));
      pending.clear(); update({ ids, pending: false, persisted: true, issue: null });
    } catch { update({ ...snapshot, persisted: false, pending: true, issue: 'write' }); }
  }
  refresh();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSaved(id: string, saved: boolean) {
      if (!isId(id) || (snapshot.ids.includes(id) === saved && !pending.has(id))) return;
      pending.set(id, saved);
      update({ ...snapshot, ids: applyPending(snapshot.ids), persisted: false, pending: true });
      persist();
    },
    refresh, persist,
  };
}
export type SavedStore = ReturnType<typeof createSavedStore>;

export type SavedRecord = { status: 'available'; event: EventRecord } | { status: 'unavailable' };
export async function loadSavedRecord(id: string, signal: AbortSignal, load = getEvent): Promise<SavedRecord> {
  try {
    const { event } = await load(id, signal);
    if (event.status !== 'published' && event.status !== 'cancelled') throw new ApiError(200, 'The saved event could not be read. Please try again.');
    return { status: 'available', event };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: 'unavailable' };
    throw error;
  }
}
