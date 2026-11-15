import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSavedStore, loadSavedRecord, parseSavedIds, savedKey } from '../src/lib/saved';
import { SaveButton, SavedStorageNotice } from '../src/components/SavedEvents';
import { EventCard } from '../src/components/EventCard';
import { EventInformation } from '../src/screens/EventDetail';
import { Saved, SavedRecordView } from '../src/screens/Saved';
import { SearchResults } from '../src/screens/Ask';
import { ApiError, getEvent } from '../src/lib/api';
import { renderWithSaves } from './render-with-saves';
import { eventFixture } from './event-fixtures';

function storageFixture(initial: string | null = null) {
  let raw = initial;
  let readFails = false; let writeFails = false; let writes = 0;
  const storage = {
    getItem(key: string) { assert.equal(key, savedKey); if (readFails) throw new Error('Blocked'); return raw; },
    setItem(key: string, value: string) { assert.equal(key, savedKey); if (writeFails) throw new Error('Quota'); raw = value; writes++; },
  };
  return { storage, raw: () => raw, writes: () => writes, external: (value: string | null) => { raw = value; }, failRead: (value: boolean) => { readFails = value; }, failWrite: (value: boolean) => { writeFails = value; } };
}

test('first use is empty, duplicate saves are ignored, and unsave removes only its ID', () => {
  const disk = storageFixture(); const store = createSavedStore(() => disk.storage);
  assert.deepEqual(store.getSnapshot(), { ids: [], pending: false, persisted: true, issue: null });
  store.setSaved('A', true); store.setSaved('A', true); store.setSaved('B', true); store.setSaved('A', false);
  assert.deepEqual(store.getSnapshot().ids, ['B']); assert.equal(disk.raw(), '["B"]'); assert.equal(disk.writes(), 3);
  store.setSaved('  ', true); assert.deepEqual(store.getSnapshot().ids, ['B']);
  assert.deepEqual(createSavedStore(() => disk.storage).getSnapshot().ids, ['B'], 'a fresh store restores IDs from persisted data');
});

test('invalid JSON, wrong shapes and mixed entries recover without storing full records', () => {
  for (const raw of ['bad json', '{}', 'null', '7', '"A"']) assert.deepEqual(parseSavedIds(raw), { ids: [], malformed: true });
  assert.deepEqual(parseSavedIds('["A",7,null,"",{},"A","B"]'), { ids: ['A', 'B'], malformed: true });
  const disk = storageFixture('["A",{"title":"private record must not be used"}]');
  const store = createSavedStore(() => disk.storage);
  assert.equal(store.getSnapshot().issue, 'malformed'); store.setSaved('B', true);
  assert.equal(disk.raw(), '["A","B"]'); assert.equal(store.getSnapshot().issue, null);
});

test('a blocked storage getter/read does not crash, and temporary saves are visibly nonpersistent', () => {
  const store = createSavedStore(() => { throw new Error('SecurityError'); });
  store.setSaved('A', true);
  assert.deepEqual(store.getSnapshot(), { ids: ['A'], persisted: false, pending: true, issue: 'read' });
  const html = renderWithSaves(<><SavedStorageNotice /><Saved /></>, store);
  assert.ok(html.includes('this tab only')); assert.ok(html.includes('Retry saving'));
  assert.ok(!html.includes('Saved in this browser.'));
});

test('failed writes preserve the current selection and retry merges pending changes with disk', () => {
  const disk = storageFixture('["A"]'); const store = createSavedStore(() => disk.storage);
  disk.failWrite(true); store.setSaved('A', false); store.setSaved('B', true);
  assert.deepEqual(store.getSnapshot().ids, ['B']); assert.equal(store.getSnapshot().persisted, false); assert.equal(store.getSnapshot().pending, true);
  assert.equal(disk.raw(), '["A"]');
  disk.external('["A","C"]'); disk.failWrite(false); store.persist();
  assert.deepEqual(store.getSnapshot(), { ids: ['C', 'B'], persisted: true, pending: false, issue: null });
  assert.equal(disk.raw(), '["C","B"]');
});

test('read recovery merges hidden existing saves instead of overwriting them', () => {
  const disk = storageFixture('["already-saved"]'); disk.failRead(true);
  const store = createSavedStore(() => disk.storage); store.setSaved('new', true);
  assert.deepEqual(store.getSnapshot().ids, ['new']); disk.failRead(false); store.persist();
  assert.deepEqual(store.getSnapshot().ids, ['already-saved', 'new']);
});

test('external storage changes refresh all subscribers while preserving pending local changes', () => {
  const disk = storageFixture('["A"]'); const store = createSavedStore(() => disk.storage);
  let first = 0; let second = 0;
  const removeFirst = store.subscribe(() => first++); const removeSecond = store.subscribe(() => second++);
  disk.external('["B"]'); store.refresh(); assert.equal(first, 1); assert.equal(second, 1);
  assert.deepEqual(store.getSnapshot().ids, ['B']);
  disk.failWrite(true); store.setSaved('local', true); disk.external('["remote"]'); store.refresh();
  assert.deepEqual(store.getSnapshot().ids, ['remote', 'local']); assert.equal(store.getSnapshot().persisted, false);
  const snapshot = store.getSnapshot(); store.refresh(); assert.equal(store.getSnapshot(), snapshot, 'unchanged snapshots stay referentially stable');
  removeFirst(); removeSecond();
});

test('a later read failure keeps known IDs, and recovery observes a cleared storage key', () => {
  const disk = storageFixture('["A"]'); const store = createSavedStore(() => disk.storage);
  disk.failRead(true); store.refresh(); assert.deepEqual(store.getSnapshot().ids, ['A']); assert.equal(store.getSnapshot().persisted, false);
  disk.failRead(false); disk.external(null); store.refresh(); assert.deepEqual(store.getSnapshot().ids, []);
});

test('404 is unavailable, transient/API errors and aborts remain retryable without deleting saves', async () => {
  const disk = storageFixture('["A"]'); const store = createSavedStore(() => disk.storage);
  assert.deepEqual(await loadSavedRecord('A', new AbortController().signal, async () => { throw new ApiError(404, 'Not found'); }), { status: 'unavailable' });
  for (const error of [new ApiError(503, 'Unavailable'), new TypeError('Network error'), new DOMException('Aborted', 'AbortError')]) {
    await assert.rejects(loadSavedRecord('A', new AbortController().signal, async () => { throw error; }), cause => cause === error);
  }
  assert.deepEqual(store.getSnapshot().ids, ['A']); assert.equal(disk.raw(), '["A"]');
});

test('current/cancelled records are returned and a private status is never rendered as a saved event', async () => {
  for (const status of ['published', 'cancelled'] as const) {
    const event = eventFixture({ status });
    assert.deepEqual(await loadSavedRecord(event.id, new AbortController().signal, async () => ({ event })), { status: 'available', event });
  }
  const invalid = { ...eventFixture(), status: 'draft' };
  await assert.rejects(loadSavedRecord('id', new AbortController().signal, async () => ({ event: invalid as never })), /could not be read/);
});

test('public detail refetch bypasses cached copies and uses the exact encoded ID', async t => {
  const event = eventFixture({ id: 'saved/id' }); let count = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/events/saved%2Fid'); assert.equal(init.cache, 'no-store');
    return Response.json({ event: { ...event, title: `Fresh title ${++count}` } });
  });
  assert.equal((await getEvent(event.id, new AbortController().signal)).event.title, 'Fresh title 1');
  assert.equal((await getEvent(event.id, new AbortController().signal)).event.title, 'Fresh title 2');
});

test('a missing/failed saved item cannot prevent independent valid items from loading', async () => {
  const event = eventFixture();
  const load = async (id: string) => { if (id === 'missing') throw new ApiError(404, 'Missing'); if (id === 'failed') throw new TypeError('Offline'); return { event }; };
  const results = await Promise.allSettled(['valid', 'missing', 'failed'].map(id => loadSavedRecord(id, new AbortController().signal, load)));
  assert.equal(results[0].status, 'fulfilled'); assert.deepEqual(results[1], { status: 'fulfilled', value: { status: 'unavailable' } }); assert.equal(results[2].status, 'rejected');
});

test('a mixed Saved view keeps valid cards, distinguishes unavailable/network failures and offers recovery', () => {
  const disk = storageFixture('["synthetic-free","missing","failed"]'); const store = createSavedStore(() => disk.storage);
  const html = renderWithSaves(<>
    <SavedRecordView id="synthetic-free" state={{ status: 'success', data: { status: 'available', event: eventFixture() } }} retry={() => {}} />
    <SavedRecordView id="missing" state={{ status: 'success', data: { status: 'unavailable' } }} retry={() => {}} />
    <SavedRecordView id="failed" state={{ status: 'error', error: new TypeError('Offline') }} retry={() => {}} />
  </>, store);
  assert.ok(html.includes('[SYNTHETIC] Campus meetup'));
  assert.ok(html.includes('This saved event is unavailable'));
  assert.ok(html.includes('Unable to connect')); assert.ok(html.includes('Try again'));
  assert.ok(html.includes('Check availability again')); assert.ok(html.includes('Remove from saved'));
  assert.deepEqual(store.getSnapshot().ids, ['synthetic-free', 'missing', 'failed']);
});

test('Discover/Ask card and detail controls agree on one saved ID and reflect unsaving', () => {
  const disk = storageFixture('["synthetic-free"]'); const store = createSavedStore(() => disk.storage); const event = eventFixture();
  const response = { answer: 'Synthetic match', constraints: { keywords: [], from: event.publishedAt, to: event.startsAt!, afterMinutes: null, freeOnly: false, foodAdvertisedOnly: false, beginnerOnly: false }, constraintSummary: [], results: [{ event, reason: 'Synthetic reason' }], excluded: [], noMatch: false, interpretedBy: 'rules' as const };
  const element = <><EventCard event={event} /><EventInformation event={event} /><SearchResults response={response} query="synthetic" /></>;
  const saved = renderWithSaves(element, store); assert.equal(saved.match(/aria-pressed="true"/g)?.length, 3); assert.equal(saved.match(/aria-label="Unsave /g)?.length, 3);
  store.setSaved(event.id, false);
  const unsaved = renderWithSaves(element, store); assert.equal(unsaved.match(/aria-pressed="false"/g)?.length, 3); assert.equal(unsaved.match(/aria-label="Save /g)?.length, 3);
});

test('empty, malformed-storage and cancelled saved displays remain clear and safe', () => {
  assert.ok(renderWithSaves(<Saved />).includes('No saved events yet'));
  const disk = storageFixture('{bad json'); const store = createSavedStore(() => disk.storage);
  assert.ok(renderWithSaves(<SavedStorageNotice />, store).includes('could not be read'));
  const cancelled = renderWithSaves(<EventCard event={eventFixture({ status: 'cancelled', title: '<script>synthetic</script>' })} headingLevel={3} />);
  assert.ok(cancelled.includes('Cancelled')); assert.ok(!cancelled.includes('<script>'));
  store.setSaved('A', true);
  assert.ok(renderWithSaves(<SaveButton id="A" title="Synthetic A" />, store).includes('aria-label="Unsave Synthetic A"'));
});
