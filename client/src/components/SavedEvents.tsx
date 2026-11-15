import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createSavedStore, savedKey, type SavedStore } from '../lib/saved';

const SavedContext = createContext<SavedStore | null>(null);

export function SavedProvider({ children, store }: { children: React.ReactNode; store?: SavedStore }) {
  const [ownedStore] = useState(() => store ?? createSavedStore(() => window.localStorage));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === savedKey || event.key === null) ownedStore.refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', ownedStore.refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', ownedStore.refresh); };
  }, [ownedStore]);
  return <SavedContext.Provider value={ownedStore}>{children}</SavedContext.Provider>;
}

export function useSavedEvents() {
  const store = useContext(SavedContext);
  if (!store) throw new Error('SavedProvider must wrap saved-event controls.');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, setSaved: store.setSaved, refreshStorage: store.refresh, retryPersistence: store.persist };
}

export function SaveButton({ id, title }: { id: string; title: string }) {
  const { ids, setSaved } = useSavedEvents();
  const saved = ids.includes(id);
  return <button type="button" className="button button-secondary save-button" data-remove-saved={saved || undefined} aria-pressed={saved} aria-label={`${saved ? 'Unsave' : 'Save'} ${title}`} onClick={() => setSaved(id, !saved)}>{saved ? 'Unsave' : 'Save'}</button>;
}

export function SavedStorageNotice() {
  const saved = useSavedEvents();
  if (!saved.issue) return null;
  const message = saved.issue === 'malformed' ? 'Some saved data could not be read. Only readable saved entries are shown. Saving or removing an event will replace unreadable data.'
    : saved.pending ? 'Changes to saved events are kept in this tab only. They may be lost on refresh. Retry when browser storage is available.'
    : 'Saved data could not be read on this browser. New saves will be kept in this tab until browser storage is available.';
  return <aside className="notice saved-storage-notice" aria-label="Saved events storage"><p role="status">{message}</p>
    <button className="button button-secondary" onClick={saved.pending ? saved.retryPersistence : saved.refreshStorage}>{saved.pending ? 'Retry saving' : 'Retry reading saved data'}</button>
  </aside>;
}
