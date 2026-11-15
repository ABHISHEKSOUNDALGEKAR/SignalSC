import './setup';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { emptyDraft } from '../extract';
import { engageScEventId, enrichEngageScFood, refreshEventFood } from '../engagesc-details';
import { importFeed } from '../importer';
import { MemoryStore, type StoredEvent } from '../store';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = new Date('2026-11-15T12:00:00-08:00');
function record(id = '413002'): StoredEvent {
  return {
    id: `event-${id}`, status: 'published', organizationId: null, organizationName: 'BSA',
    data: {
      ...emptyDraft('https://engage.usc.edu/rsvp?id=' + id), sourceKind: 'engagesc',
      title: 'BSA Weekly General Body Meeting', description: 'Networking and professional development.',
      startsAt: '2026-11-16T18:00:00-08:00', endsAt: '2026-11-16T19:00:00-08:00',
    },
    flyerId: null, extractedBy: 'import', confirmation: 'source-imported', externalId: `engagesc:${id}`,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), publishedAt: now.toISOString(),
  };
}
function detail(id = '413002', included: boolean | null = true) {
  return { id: Buffer.from(`usc:Event:${id}`).toString('base64'), name: 'BSA Weekly General Body Meeting', isFoodIncluded: included, foodDetails: null };
}

test('only approved public EngageSC event URLs can trigger a detail request', () => {
  assert.equal(engageScEventId('https://engage.usc.edu/rsvp?id=413002'), '413002');
  assert.equal(engageScEventId('https://engage.usc.edu/bsa/rsvp_boot?id=413002'), '413002');
  for (const url of ['http://engage.usc.edu/rsvp?id=1', 'https://engage.usc.edu.evil.test/rsvp?id=1', 'https://127.0.0.1/rsvp?id=1', 'https://user:pass@engage.usc.edu/rsvp?id=1', 'https://engage.usc.edu/admin?id=1', 'https://engage.usc.edu/rsvp?id=not-a-number']) {
    assert.equal(engageScEventId(url), null);
  }
});

test('public Food Provided enriches a feed omission without inventing admission, venue, or suitability', async () => {
  const store = new MemoryStore();
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://engage.usc.edu/api/v2/graphql');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    const query = JSON.parse(String(options?.body)).query;
    assert.match(query, /isFoodIncluded foodDetails/);
    assert.doesNotMatch(query, /location|attendees|descriptionText/);
    return Response.json({ data: { e0: detail() } });
  };
  const [first] = await enrichEngageScFood(store, [record()], now);
  assert.equal(first.data.food, 'advertised');
  assert.equal(first.data.costCents, null);
  assert.equal(first.data.location, null);
  assert.equal(first.data.beginnerFriendly, null);
  assert.match(first.data.evidence[0].excerpt, /Food Provided/);
  assert.equal((await enrichEngageScFood(store, [record()], now))[0].data.food, 'advertised');
  assert.equal(calls, 1);
});

test('false or missing public fields do not claim no food or overwrite stronger feed evidence', async () => {
  for (const payload of [detail('413002', false), detail('413002', null), { ...detail(), id: 'wrong-event' }]) {
    const store = new MemoryStore();
    globalThis.fetch = async () => Response.json({ data: { e0: payload } });
    const [result] = await enrichEngageScFood(store, [record()], now);
    assert.equal(result.data.food, 'unknown');
  }
  const known = record();
  known.data.food = 'advertised';
  globalThis.fetch = async () => Response.json({ data: { e0: detail('413002', false) } });
  assert.equal((await enrichEngageScFood(new MemoryStore(), [known], now))[0].data.food, 'advertised');
});

test('temporary source errors preserve cached food evidence and retry later', async () => {
  const store = new MemoryStore();
  globalThis.fetch = async () => Response.json({ data: { e0: detail() } });
  await enrichEngageScFood(store, [record()], now);
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Synthetic source outage'); };
  const later = new Date(now.getTime() + 7 * 3_600_000);
  assert.equal((await enrichEngageScFood(store, [record()], later))[0].data.food, 'advertised');
  assert.equal((await enrichEngageScFood(store, [record()], later))[0].data.food, 'advertised');
  assert.equal(calls, 1);
});

test('detail refresh deduplicates requests and retains event IDs and feedback', async () => {
  const store = new MemoryStore();
  const item = record();
  await store.insert(item);
  await store.addFeedback({ id: 'f1', eventId: item.id, rating: 5, wouldReturn: null, comment: '', deviceKey: 'test-device', demo: false, createdAt: now.toISOString() });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: { e0: detail() } }); };
  const results = await Promise.all([refreshEventFood(store, item), refreshEventFood(store, item)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.id === item.id && result.data.food === 'advertised'));
  assert.equal((await store.get(item.id))?.data.food, 'advertised');
  assert.equal((await store.listFeedback(item.id)).length, 1);
});

test('feed imports retain past events, batch upcoming public checks, and keep IDs stable', async () => {
  const store = new MemoryStore();
  const ics = ['BEGIN:VCALENDAR', ...[
    ['past', '20261112T020000Z', '413001'],
    ['future', '20261117T020000Z', '413002'],
    ['future-2', '20261118T020000Z', '413003'],
  ].flatMap(([uid, start, id]) => [
    'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:Archive Meetup ${uid}`, `DTSTART:${start}`,
    `URL:https://engage.usc.edu/rsvp?id=${id}`, 'END:VEVENT',
  ]), 'END:VCALENDAR'].join('\r\n');
  let networkCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('.ics')) return new Response(ics);
    networkCalls++;
    return Response.json({ data: { e0: detail('413002'), e1: detail('413003') } });
  };
  assert.equal((await importFeed(store, 'https://engage.usc.edu/test.ics', now)).inserted, 3);
  const first = await store.list({ statuses: ['published'] });
  assert.equal(first.find(r => r.externalId === 'engagesc:past')?.data.food, 'unknown');
  assert.equal(first.find(r => r.externalId === 'engagesc:future')?.data.food, 'advertised');
  assert.equal(networkCalls, 1);
  assert.equal((await importFeed(store, 'https://engage.usc.edu/test.ics', now)).unchanged, 3);
  assert.deepEqual((await store.list({ statuses: ['published'] })).map(r => r.id), first.map(r => r.id));
  assert.equal(networkCalls, 1);
});
