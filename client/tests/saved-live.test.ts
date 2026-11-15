/** Explicit integration: local disposable memory backend, no real records/model calls. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DraftResponse, EventResponse } from '../../shared/api';
import { createSavedStore, loadSavedRecord, savedKey } from '../src/lib/saved';
import { ApiError } from '../src/lib/api';

const origin = 'http://127.0.0.1:5174';
const originalFetch = globalThis.fetch;
async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return originalFetch(origin + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('saved IDs refetch real edits/cancellations, isolate failures, and remain independent of organizer cookies', async t => {
  const health = await (await request('/api/health')).json();
  assert.equal(health.mode, 'memory', 'Disposable memory mode required'); assert.equal(health.modelConfigured, false, 'Model calls must be disabled');
  const login = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-a' }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const topic = `savedstepfive${Date.now()}`;
  async function makeDraft(suffix: string) {
    const result = await request('/api/organizer/drafts', cookie, 'POST', { text: `[SYNTHETIC] ${topic} ${suffix}` }); assert.equal(result.status, 201);
    const id = (await result.json() as DraftResponse).draft.id;
    assert.equal((await request(`/api/organizer/drafts/${id}`, cookie, 'PATCH', { title: `[SYNTHETIC] ${topic} ${suffix}`, startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), location: 'Synthetic saved-event room', sourceUrl: 'https://example.com/synthetic-saved-source', costCents: 0, food: 'advertised', beginnerFriendly: true })).status, 200);
    return id;
  }
  const id = await makeDraft('lifecycle');
  assert.equal((await request(`/api/organizer/drafts/${id}/publish`, cookie, 'POST')).status, 200);
  const disk = new Map<string, string>();
  const store = createSavedStore(() => ({ getItem: key => disk.get(key) ?? null, setItem: (key, value) => { disk.set(key, value); } }));
  store.setSaved(id, true);
  t.mock.method(globalThis, 'fetch', (url: string | URL | Request, init?: RequestInit) => originalFetch(typeof url === 'string' && url.startsWith('/api/') ? origin + url : url, init));
  const first = await loadSavedRecord(id, new AbortController().signal); assert.equal(first.status, 'available');
  const editedTitle = `[SYNTHETIC] ${topic} edited`;
  assert.equal((await request(`/api/organizer/events/${id}`, cookie, 'PATCH', { title: editedTitle })).status, 200);
  const edited = await loadSavedRecord(id, new AbortController().signal); assert.equal(edited.status, 'available');
  if (edited.status === 'available') assert.equal(edited.event.title, editedTitle);
  assert.equal((await request(`/api/organizer/events/${id}`, cookie, 'PATCH', { cancelled: true })).status, 200);
  const cancelled = await loadSavedRecord(id, new AbortController().signal); assert.equal(cancelled.status, 'available');
  if (cancelled.status === 'available') assert.equal(cancelled.event.status, 'cancelled');
  const privateId = await makeDraft('private draft'); store.setSaved(privateId, true); store.setSaved('synthetic-missing-step-five', true);
  const mixed = await Promise.all([id, privateId, 'synthetic-missing-step-five'].map(value => loadSavedRecord(value, new AbortController().signal)));
  assert.deepEqual(mixed.map(value => value.status), ['available', 'unavailable', 'unavailable']);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Synthetic outage' }, { status: 503 }));
  await assert.rejects(loadSavedRecord(id, new AbortController().signal), error => error instanceof ApiError && error.status === 503);
  assert.deepEqual(store.getSnapshot().ids, [id, privateId, 'synthetic-missing-step-five']);
  t.mock.method(globalThis, 'fetch', (url: string | URL | Request, init?: RequestInit) => originalFetch(typeof url === 'string' && url.startsWith('/api/') ? origin + url : url, init));
  assert.equal((await loadSavedRecord(id, new AbortController().signal)).status, 'available');
  assert.deepEqual(JSON.parse(disk.get(savedKey)!), [id, privateId, 'synthetic-missing-step-five']); assert.ok(!disk.get(savedKey)!.includes(editedTitle));
  const browserId = await makeDraft('browser fixture');
  const browserPublish = await request(`/api/organizer/drafts/${browserId}/publish`, cookie, 'POST'); assert.equal(browserPublish.status, 200);
  assert.equal((await browserPublish.json() as EventResponse).event.id, browserId);
  assert.equal((await request('/api/organizer/session', cookie, 'DELETE')).status, 204);
  assert.equal((await request('/api/organizer/session')).status, 401);
  assert.equal((await loadSavedRecord(id, new AbortController().signal)).status, 'available');
  t.diagnostic(`Browser fixture: ${topic} browser fixture; event ID ${browserId}. Synthetic memory records retained for browser verification.`);
});
