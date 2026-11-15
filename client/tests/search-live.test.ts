/** Explicit disposable local memory integration. Never use production data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DraftResponse, EventRecord, EventResponse, SearchResponse } from '../../shared/api';
import { campusDayStart } from '../src/lib/events';

const origin = process.env.FRONTEND_TEST_ORIGIN ?? 'http://127.0.0.1:5174';
async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return fetch(origin + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('real search finds published records, honors strict unknown exclusions and returns honest no-match', async t => {
  const health = await (await request('/api/health')).json();
  assert.equal(health.mode, 'memory', 'Disposable memory mode required');
  assert.equal(health.modelConfigured, false, 'This test must not make model calls');
  const login = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-a' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const topic = `signaltestfour${Date.now()}`;
  const startsAt = new Date(+campusDayStart(new Date(), 2) + 12 * 3600000).toISOString();
  const records: EventRecord[] = [];
  const patches = [
    { title: `[SYNTHETIC] ${topic} confirmed`, costCents: 0, food: 'advertised', beginnerFriendly: true },
    { title: `[SYNTHETIC] ${topic} unknown cost`, costCents: null, food: 'advertised', beginnerFriendly: true },
    { title: `[SYNTHETIC] ${topic} unknown food`, costCents: 0, food: 'unknown', beginnerFriendly: true },
    { title: `[SYNTHETIC] ${topic} unknown suitability`, costCents: 0, food: 'advertised', beginnerFriendly: null },
  ];
  const draftIds: string[] = [];
  for (const patch of [...patches, { ...patches[0], title: `[SYNTHETIC] ${topic} private draft` }, { ...patches[0], title: `[SYNTHETIC] ${topic} cancelled` }]) {
    const created = await request('/api/organizer/drafts', cookie, 'POST', { text: `[SYNTHETIC] ${topic} test announcement` });
    assert.equal(created.status, 201);
    const id = (await created.json() as DraftResponse).draft.id;
    assert.equal((await request(`/api/organizer/drafts/${id}`, cookie, 'PATCH', { ...patch, startsAt, location: 'Synthetic search room', sourceUrl: 'https://example.com/synthetic-search-source' })).status, 200);
    if (patch.title.endsWith('private draft')) { draftIds.push(id); continue; }
    const published = await request(`/api/organizer/drafts/${id}/publish`, cookie, 'POST');
    assert.equal(published.status, 200);
    const event = (await published.json() as EventResponse).event;
    if (patch.title.endsWith('cancelled')) {
      assert.equal((await request(`/api/organizer/events/${id}`, cookie, 'PATCH', { cancelled: true })).status, 200);
      draftIds.push(id);
    } else records.push(event);
  }
  async function ask(query: string) {
    const res = await request('/api/search', '', 'POST', { query }); assert.equal(res.status, 200);
    const data = await res.json() as SearchResponse;
    for (const result of data.results) { assert.ok(!draftIds.includes(result.event.id)); assert.ok(records.some(record => record.id === result.event.id)); assert.ok(result.reason); }
    return data;
  }
  const broad = await ask(topic);
  assert.deepEqual(new Set(broad.results.map(result => result.event.id)), new Set(records.map(record => record.id)));
  for (const [suffix, missingId] of [['free events', records[1].id], ['events with food', records[2].id], ['events for beginners', records[3].id]]) {
    const data = await ask(`${topic} ${suffix}`);
    assert.equal(data.results.length, 3); assert.ok(!data.results.some(result => result.event.id === missingId)); assert.ok(data.excluded.length);
  }
  const strict = await ask(`${topic} free events with food for beginners`);
  assert.equal(strict.constraints.freeOnly, true); assert.equal(strict.constraints.foodAdvertisedOnly, true); assert.equal(strict.constraints.beginnerOnly, true);
  assert.deepEqual(strict.results.map(result => result.event.id), [records[0].id]);
  assert.equal(strict.excluded.reduce((sum, note) => sum + note.count, 0), 3);
  const noMatch = await ask(`${topic} free events after 11 pm`);
  assert.equal(noMatch.noMatch, true); assert.deepEqual(noMatch.results, []); assert.ok(noMatch.answer); assert.ok(noMatch.excluded.length);
  const detail = await request(`/api/events/${records[0].id}`); assert.equal(detail.status, 200);
  t.diagnostic(`Browser search topic: ${topic}. Synthetic memory records intentionally retained for browser verification.`);
});
