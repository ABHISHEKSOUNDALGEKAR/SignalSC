import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';

// Isolated process fixtures: no real credentials, provider calls, or database writes.
process.env.NODE_ENV = 'development';
delete process.env.REPLIT_DEPLOYMENT;
process.env.ORGANIZER_ACCESS_CODES = 'Test Campus A=test-campus-a;Test Campus B=test-campus-b';
process.env.SESSION_SECRET = 'isolated-event-flow-test-secret';
delete process.env.DATABASE_URL;
delete process.env.MODEL_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const { apiRouter } = await import('../server/routes');
const { createStore } = await import('../server/store');

test('real HTTP organizer lifecycle, student discovery, and ownership boundaries', async t => {
  const store = createStore();
  await store.init();
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', apiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  async function request(path: string, method = 'GET', body?: unknown, cookie?: string) {
    return fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function login(accessCode: string) {
    const response = await request('/organizer/session', 'POST', { accessCode });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }

  await t.test('empty states and unauthenticated actions are explicit', async () => {
    assert.deepEqual((await (await request('/events')).json()).events, []);
    const search = await (await request('/search', 'POST', { query: 'free food today' })).json();
    assert.equal(search.noMatch, true);
    assert.deepEqual(search.results, []);
    assert.ok(search.answer);
    assert.equal((await request('/organizer/session')).status, 401);
    assert.equal((await request('/organizer/drafts', 'POST', { text: 'Announcement' })).status, 401);
    assert.equal((await request('/organizer/events')).status, 401);
    assert.equal((await request('/organizer/import-health')).status, 401);
    assert.equal((await request('/import-health')).status, 404);
    assert.equal((await request('/events/missing')).status, 404);
    assert.equal((await request('/organizer/session', 'POST', { accessCode: 'wrong' })).status, 401);
  });

  const cookieA = await login('test-campus-a');
  const cookieB = await login('test-campus-b');
  await t.test('import health is read-only, private, and explicit when unavailable', async () => {
    const response = await request('/organizer/import-health', 'GET', undefined, cookieA);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { modelConfigured: false, runs: [], feedImports: [] });
    const { feedImportHealthRecorder, importHealthRecorder } = await import('../server/import-health');
    const recorder = importHealthRecorder(store, 'engagesc', new Date());
    recorder.add('not_configured', 3, 0);
    await recorder.save();
    const feedRecorder = feedImportHealthRecorder(store, 'usc-calendar', new Date('2035-01-02T00:00:00Z'));
    feedRecorder.fetchFailed('request_failed');
    await feedRecorder.save();
    const summary = await (await request('/organizer/import-health', 'GET', undefined, cookieB)).json();
    assert.equal(summary.runs[0].outcomes[0].retryEligible, 0);
    assert.equal(summary.runs[0].outcomes[0].outcome, 'not_configured');
    assert.equal(summary.feedImports[0].fetch.failureCategory, 'request_failed');
    assert.equal(summary.feedImports[0].eventSave.status, 'not_attempted');
    assert.equal((await request('/organizer/import-health', 'POST', {}, cookieA)).status, 404);
    await store.setMeta('import-health:v1:engagesc', 'private-broken-metadata');
    const unavailable = await request('/organizer/import-health', 'GET', undefined, cookieA);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: 'Import health is temporarily unavailable.' });
  });
  let id = '';
  await t.test('create and resume a private flyer draft and report missing publish fields', async () => {
    assert.equal((await (await request('/organizer/session', 'GET', undefined, cookieA)).json()).organizationName, 'Test Campus A');
    assert.deepEqual((await (await request('/organizer/drafts', 'GET', undefined, cookieA)).json()).drafts, []);
    assert.deepEqual((await (await request('/organizer/events', 'GET', undefined, cookieA)).json()).events, []);
    const response = await request('/organizer/drafts', 'POST', {
      text: 'Campus picnic. Please review all details.',
      imageBase64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      mimeType: 'image/gif',
    }, cookieA);
    assert.equal(response.status, 201);
    const { draft } = await response.json();
    id = draft.id;
    assert.equal(draft.extractedBy, 'manual');
    assert.ok(draft.draft.uncertainties.length);
    assert.equal((await request(draft.flyerUrl.replace('/api', ''))).headers.get('content-type'), 'image/gif');
    assert.equal((await request(`/events/${id}`)).status, 404);
    assert.equal((await (await request('/organizer/drafts', 'GET', undefined, cookieA)).json()).drafts[0].id, id);
    const publish = await request(`/organizer/drafts/${id}/publish`, 'POST', undefined, cookieA);
    assert.equal(publish.status, 422);
    assert.deepEqual((await publish.json()).missing, ['title', 'startsAt', 'location']);
  });

  await t.test('a second organization cannot list, modify, or publish another draft', async () => {
    assert.deepEqual((await (await request('/organizer/drafts', 'GET', undefined, cookieB)).json()).drafts, []);
    for (const [path, method, body] of [
      [`/organizer/drafts/${id}`, 'PATCH', { title: 'Hijacked' }],
      [`/organizer/drafts/${id}/publish`, 'POST', undefined],
    ] as const) {
      const response = await request(path, method, body, cookieB);
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /another organization/);
    }
  });

  const tomorrow = new Date(Date.now() + 86_400_000);
  const startsAt = tomorrow.toISOString();
  await t.test('review saves unknown facts without guessing, then publish reaches discovery and search', async () => {
    const response = await request(`/organizer/drafts/${id}`, 'PATCH', {
      title: 'Campus Picnic Regression', startsAt, location: 'TCC courtyard',
      costCents: 0, food: 'advertised', eligibility: null, beginnerFriendly: null,
      registrationUrl: 'https://example.org/register', sourceUrl: 'https://example.org/announcement',
    }, cookieA);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).draft.draft.eligibility, null);
    const publish = await request(`/organizer/drafts/${id}/publish`, 'POST', undefined, cookieA);
    assert.equal(publish.status, 200);
    const { event } = await publish.json();
    assert.equal(event.confirmation, 'organizer-confirmed');
    assert.deepEqual(event.uncertainties, []);
    const list = await (await request('/events?free=1&food=1&q=Picnic')).json();
    assert.equal(list.events[0].id, id);
    assert.equal((await (await request(`/events/${id}`)).json()).event.title, 'Campus Picnic Regression');
    const search = await (await request('/search', 'POST', { query: 'picnic' })).json();
    assert.ok(search.results.some((r: { event: { id: string } }) => r.event.id === id));
    assert.deepEqual((await (await request('/organizer/drafts', 'GET', undefined, cookieA)).json()).drafts, []);
    const calendar = await request(`/events/${id}/calendar.ics`);
    assert.match(calendar.headers.get('content-disposition')!, /attachment/);
    assert.match(await calendar.text(), /BEGIN:VEVENT/);
  });

  await t.test('editing validates times and does not allow cross-organization changes', async () => {
    const invalid = await request(`/organizer/events/${id}`, 'PATCH', { endsAt: new Date(tomorrow.getTime() - 60_000).toISOString() }, cookieA);
    assert.equal(invalid.status, 400);
    const missing = await request(`/organizer/events/${id}`, 'PATCH', { location: null }, cookieA);
    assert.equal(missing.status, 422);
    const other = await request(`/organizer/events/${id}`, 'PATCH', { cancelled: true }, cookieB);
    assert.equal(other.status, 403);
    assert.deepEqual((await (await request('/organizer/events', 'GET', undefined, cookieB)).json()).events, []);
    const edit = await request(`/organizer/events/${id}`, 'PATCH', { location: 'Updated courtyard', costCents: 500 }, cookieA);
    assert.equal(edit.status, 200);
    assert.equal((await (await request(`/events/${id}`)).json()).event.location, 'Updated courtyard');
    assert.deepEqual((await (await request('/events?free=1')).json()).events, []);
  });

  await t.test('cancellation leaves saved details readable but hides discovery and search', async () => {
    const cancel = await request(`/organizer/events/${id}`, 'PATCH', { cancelled: true }, cookieA);
    assert.equal(cancel.status, 200);
    assert.equal((await (await request(`/events/${id}`)).json()).event.status, 'cancelled');
    assert.deepEqual((await (await request('/events')).json()).events, []);
    assert.equal((await (await request('/search', 'POST', { query: 'picnic' })).json()).noMatch, true);
    assert.match(await (await request(`/events/${id}/calendar.ics`)).text(), /STATUS:CANCELLED/);
    assert.equal((await (await request('/organizer/events', 'GET', undefined, cookieA)).json()).events[0].status, 'cancelled');
    const logout = await request('/organizer/session', 'DELETE', undefined, cookieA);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  });
});
