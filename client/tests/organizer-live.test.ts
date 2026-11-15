/** Explicit real API tests: local disposable memory backend only; never production. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DraftResponse, DraftsResponse, EventResponse, EventsResponse } from '../../shared/api';

const origin = process.env.FRONTEND_TEST_ORIGIN ?? 'http://127.0.0.1:5174';
async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return fetch(origin + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4V0AAAAASUVORK5CYII=';

test('organizer real API lifecycle, two-organization isolation, image upload and public regressions', async t => {
  const health = await (await request('/api/health')).json();
  assert.equal(health.mode, 'memory', 'Run only against a disposable in-memory backend');
  assert.equal(health.modelConfigured, false, 'Automatic model calls must be disabled for this synthetic test');
  assert.equal((await request('/api/organizer/session')).status, 401);
  assert.equal((await request('/api/organizer/session', '', 'POST', { accessCode: 'invalid-synthetic-code' })).status, 401);
  const a = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-a' });
  assert.equal(a.status, 200);
  const cookieA = a.headers.get('set-cookie')!.split(';')[0];
  const b = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-b' });
  assert.equal(b.status, 200);
  const cookieB = b.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await (await request('/api/organizer/session', cookieA)).json()).organizationName, 'Demo Org A');
  assert.equal((await (await request('/api/organizer/session', cookieB)).json()).organizationName, 'Demo Org B');
  const created = await request('/api/organizer/drafts', cookieA, 'POST', { text: '[SYNTHETIC] Step 3 announcement; date and location require review.' });
  assert.equal(created.status, 201);
  const draft = (await created.json() as DraftResponse).draft;
  assert.equal(draft.extractedBy, 'manual');
  assert.ok(draft.draft.uncertainties.length);
  assert.equal((await request(`/api/events/${draft.id}`)).status, 404);
  assert.equal((await request(`/api/organizer/drafts/${draft.id}`, cookieB, 'PATCH', { location: 'Unauthorized' })).status, 403);
  const bDrafts = await (await request('/api/organizer/drafts', cookieB)).json() as DraftsResponse;
  assert.ok(!bDrafts.drafts.some(record => record.id === draft.id));
  const missing = await request(`/api/organizer/drafts/${draft.id}/publish`, cookieA, 'POST');
  assert.equal(missing.status, 422);
  assert.deepEqual((await missing.json()).missing, ['title', 'startsAt', 'location']);
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const patch = { title: '[SYNTHETIC] Step 3 lifecycle test', startsAt, location: 'Synthetic test room', costCents: 29, food: 'unknown', beginnerFriendly: false, registrationDeadline: null };
  assert.equal((await request(`/api/organizer/drafts/${draft.id}`, cookieA, 'PATCH', patch)).status, 200);
  const resumed = (await (await request('/api/organizer/drafts', cookieA)).json() as DraftsResponse).drafts.find(record => record.id === draft.id)!;
  assert.equal(resumed.draft.costCents, 29); assert.equal(resumed.draft.beginnerFriendly, false);
  assert.deepEqual(resumed.draft.evidence, draft.draft.evidence);
  const published = await request(`/api/organizer/drafts/${draft.id}/publish`, cookieA, 'POST');
  assert.equal(published.status, 200);
  const event = (await published.json() as EventResponse).event;
  assert.equal(event.confirmation, 'organizer-confirmed');
  const publicEvents = await (await request('/api/events')).json() as EventsResponse;
  assert.ok(publicEvents.events.some(record => record.id === event.id));
  const search = await (await request('/api/search', '', 'POST', { query: 'Step 3 lifecycle' })).json();
  assert.ok(search.results.some((result: { event: { id: string } }) => result.event.id === event.id), 'server search finds the newly published event; Ask UI is still Step 4');
  assert.equal((await request(`/api/organizer/events/${event.id}`, cookieB, 'PATCH', { title: 'Unauthorized' })).status, 403);
  assert.equal((await request(`/api/organizer/events/${event.id}`, '', 'PATCH', { cancelled: true })).status, 401);
  assert.equal((await request('/api/organizer/events/does-not-exist', cookieA, 'PATCH', { cancelled: true })).status, 404);
  assert.equal((await request(`/api/organizer/events/${event.id}`, cookieA, 'PATCH', { title: '[SYNTHETIC] Step 3 edited title' })).status, 200);
  assert.equal((await (await request(`/api/events/${event.id}`)).json() as EventResponse).event.title, '[SYNTHETIC] Step 3 edited title');
  assert.equal((await request(`/api/organizer/events/${event.id}`, cookieA, 'PATCH', { cancelled: true })).status, 200);
  assert.equal((await (await request(`/api/events/${event.id}`)).json() as EventResponse).event.status, 'cancelled');
  assert.ok(!(await (await request('/api/events')).json() as EventsResponse).events.some(record => record.id === event.id));
  assert.ok((await (await request('/api/organizer/events', cookieA)).json() as EventsResponse).events.some(record => record.id === event.id && record.status === 'cancelled'));
  for (const input of [{ imageBase64: png, mimeType: 'image/png' }, { imageBase64: png, mimeType: 'image/png', text: '[SYNTHETIC] Image plus announcement' }]) {
    const result = await request('/api/organizer/drafts', cookieA, 'POST', input);
    assert.equal(result.status, 201);
    const imageDraft = (await result.json() as DraftResponse).draft;
    assert.ok(imageDraft.flyerUrl);
    assert.equal((await request(imageDraft.flyerUrl!)).headers.get('content-type'), 'image/png');
  }
  const logout = await request('/api/organizer/session', cookieA, 'DELETE');
  assert.equal(logout.status, 204); assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/api/organizer/session')).status, 401);
  // A signed cookie with an expired/invalid signature must also be denied.
  assert.equal((await request('/api/organizer/drafts', 'ts_organizer=demo-org-a.1.invalid')).status, 401);
  t.diagnostic('Real session, manual extraction, publication, search, edit/cancel, image storage, and ownership checks passed with synthetic memory records.');
});
