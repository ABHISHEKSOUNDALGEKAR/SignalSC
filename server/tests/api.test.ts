import './setup';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { apiRouter } from '../routes';
import { MemoryStore } from '../store';
import { toCampusIso } from '../time';

let server: Server;
let base = '';

before(async () => {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', apiRouter(new MemoryStore()));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server.close(); });

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text, headers: response.headers };
}

async function signIn(accessCode: string) {
  const r = await call('POST', '/organizer/session', { body: { accessCode } });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/i);
  return cookie.split(';')[0];
}

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const startsAt = toCampusIso(tomorrow);
const endsAt = toCampusIso(new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000));

test('organizer routes require a valid access code', async () => {
  assert.equal((await call('GET', '/organizer/drafts')).status, 401);
  assert.equal((await call('POST', '/organizer/drafts', { body: { text: 'hello' } })).status, 401);
  assert.equal((await call('POST', '/organizer/session', { body: { accessCode: 'wrong' } })).status, 401);
  assert.equal((await call('GET', '/organizer/drafts', { cookie: 'ts_organizer=test-org-a.9999999999.forged' })).status, 401);
});

test('draft to published event: private until reviewed, owned by one organization', async t => {
  const orgA = await signIn('code-a');
  const orgB = await signIn('code-b');
  let id = '';

  await t.test('uploads need an image type or text', async () => {
    assert.equal((await call('POST', '/organizer/drafts', { cookie: orgA, body: {} })).status, 400);
    assert.equal((await call('POST', '/organizer/drafts', { cookie: orgA, body: { imageBase64: 'aGVsbG8=' } })).status, 400);
  });

  await t.test('without a model the draft is empty and flagged for manual entry', async () => {
    const r = await call('POST', '/organizer/drafts', { cookie: orgA, body: { text: 'Robotics Build Night, snacks!' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.draft.extractedBy, 'manual');
    assert.equal(r.json.draft.draft.startsAt, null);
    assert.equal(r.json.draft.draft.food, 'unknown');
    assert.ok(r.json.draft.draft.uncertainties.length > 0);
    id = r.json.draft.id;
  });

  await t.test('drafts are invisible to students and to other organizations', async () => {
    assert.equal((await call('GET', `/events/${id}`)).status, 404);
    assert.equal((await call('GET', `/events/${id}/calendar.ics`)).status, 404);
    assert.deepEqual((await call('GET', '/events')).json.events, []);
    assert.deepEqual((await call('GET', '/organizer/drafts', { cookie: orgB })).json.drafts, []);
    assert.equal((await call('GET', '/organizer/drafts', { cookie: orgA })).json.drafts.length, 1);
  });

  await t.test('publishing is refused until required facts are present', async () => {
    const r = await call('POST', `/organizer/drafts/${id}/publish`, { cookie: orgA });
    assert.equal(r.status, 422);
    assert.deepEqual(r.json.missing, ['title', 'startsAt', 'location']);
  });

  await t.test('another organization cannot edit or publish the draft', async () => {
    assert.equal((await call('PATCH', `/organizer/drafts/${id}`, { cookie: orgB, body: { title: 'Hijacked' } })).status, 403);
    assert.equal((await call('POST', `/organizer/drafts/${id}/publish`, { cookie: orgB })).status, 403);
  });

  await t.test('the owner corrects and publishes', async () => {
    const patch = await call('PATCH', `/organizer/drafts/${id}`, {
      cookie: orgA,
      body: { title: 'Robotics Build Night', startsAt, endsAt, location: 'RTH 105', food: 'advertised', costCents: 0 },
    });
    assert.equal(patch.status, 200);
    const published = await call('POST', `/organizer/drafts/${id}/publish`, { cookie: orgA });
    assert.equal(published.status, 200);
    assert.equal(published.json.event.confirmation, 'organizer-confirmed');
    assert.equal(published.json.event.organizationName, 'Test Org A');
    assert.deepEqual(published.json.event.uncertainties, []);
  });

  await t.test('students can list, filter, search and export it', async () => {
    assert.equal((await call('GET', '/events')).json.events.length, 1);
    assert.equal((await call('GET', '/events?free=1&food=1&q=robotics')).json.events.length, 1);
    assert.equal((await call('GET', '/events?q=poetry')).json.events.length, 0);
    const found = await call('POST', '/search', { body: { query: 'robotics with food' } });
    assert.equal(found.json.noMatch, false);
    assert.equal(found.json.results[0].event.id, id);
    const ics = await call('GET', `/events/${id}/calendar.ics`);
    assert.match(ics.headers.get('content-type') ?? '', /text\/calendar/);
    assert.match(ics.text, /SUMMARY:Robotics Build Night/);
    assert.match(ics.text, /STATUS:CONFIRMED/);
  });

  await t.test('another organization cannot edit or cancel the event', async () => {
    assert.equal((await call('PATCH', `/organizer/events/${id}`, { cookie: orgB, body: { cancelled: true } })).status, 403);
    assert.equal((await call('PATCH', `/organizer/events/${id}`, { cookie: orgB, body: { title: 'Hijacked' } })).status, 403);
    assert.equal((await call('GET', `/events/${id}`)).json.event.title, 'Robotics Build Night');
  });

  await t.test('a published event cannot lose required facts', async () => {
    assert.equal((await call('PATCH', `/organizer/events/${id}`, { cookie: orgA, body: { location: null } })).status, 422);
  });

  await t.test('cancelling removes it from lists and search but keeps the notice for saved links', async () => {
    assert.equal((await call('PATCH', `/organizer/events/${id}`, { cookie: orgA, body: { cancelled: true } })).status, 200);
    assert.deepEqual((await call('GET', '/events')).json.events, []);
    assert.equal((await call('POST', '/search', { body: { query: 'robotics' } })).json.noMatch, true);
    assert.equal((await call('GET', `/events/${id}`)).json.event.status, 'cancelled');
    assert.match((await call('GET', `/events/${id}/calendar.ics`)).text, /STATUS:CANCELLED/);
  });
});

test('search rejects empty and oversized questions', async () => {
  assert.equal((await call('POST', '/search', { body: { query: '   ' } })).status, 400);
  assert.equal((await call('POST', '/search', { body: { query: 'x'.repeat(501) } })).status, 400);
});
