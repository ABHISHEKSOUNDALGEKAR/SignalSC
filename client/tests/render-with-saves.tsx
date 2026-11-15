import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedProvider } from '../src/components/SavedEvents';
import { createSavedStore, type SavedStore } from '../src/lib/saved';

export function renderWithSaves(element: React.ReactNode, store?: SavedStore) {
  const memory = new Map<string, string>();
  const owned = store ?? createSavedStore(() => ({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } }));
  return renderToStaticMarkup(<SavedProvider store={owned}>{element}</SavedProvider>);
}
