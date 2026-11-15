import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
process.env.MODEL_API_KEY = 'isolated-search-test';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_NAME = 'search-fixture';
const { search, interpretWithRules } = await import('../server/search');
const { emptyDraft } = await import('../server/extract');
import type { EventRecord } from '../shared/api';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = new Date('2026-11-15T01:00:00-08:00');
function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    ...emptyDraft(null), id: 'food-event', title: 'Leadership Summit', description: 'Refreshments will be provided.',
    startsAt: '2026-11-17T17:00:00-08:00', endsAt: '2026-11-17T19:00:00-08:00',
    status: 'published', organizationName: 'Student Org', food: 'advertised', costCents: null,
    beginnerFriendly: null, publishedAt: now.toISOString(), updatedAt: now.toISOString(),
    flyerUrl: null, ...overrides,
  };
}
function fixture(interpretation: object, answer = {}) {
  let calls = 0;
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { content: JSON.stringify(++calls === 1 ? interpretation : { answer: 'Explore these campus events.', reasons: [], ...answer }) } }],
  });
  return () => calls;
}

test('free food overrides an incorrect model admission filter and redundant topic keyword', async () => {
  const calls = fixture({ keywords: ['food'], freeOnly: true, foodAdvertisedOnly: true, dateFrom: '2026-11-15', dateTo: '2026-11-22', afterTime: '00:00' });
  const response = await search('free food next week', [event()], now);
  assert.equal(response.interpretedBy, 'model');
  assert.equal(response.constraints.freeOnly, false);
  assert.deepEqual(response.constraints.keywords, []);
  assert.equal(response.constraints.afterMinutes, null);
  assert.equal(response.constraints.from, '2026-11-16T00:00:00-08:00');
  assert.equal(response.constraints.to, '2026-11-23T00:00:00-08:00');
  assert.equal(response.results[0]?.event.id, 'food-event');
  assert.equal(response.noMatch, false);
  assert.match(response.answer, /does not confirm food is free/);
  assert.equal(calls(), 2);
});

test('beginner filter is not also a required topic and unknown suitability is suggested honestly', async () => {
  fixture({ keywords: ['beginner-friendly', 'beginner', 'no experience', 'no experience needed'], beginnerOnly: true, dateFrom: '2026-11-15', dateTo: '2026-11-15', afterTime: '01:00' });
  const response = await search('Beginner-friendly events', [
    event({ id: 'known', title: 'Community Meetup', beginnerFriendly: true }),
    event({ id: 'unknown', title: 'Art Circle' }),
  ], now);
  assert.deepEqual(response.constraints.keywords, []);
  assert.deepEqual(response.results.map(r => r.event.id), ['known']);
  assert.deepEqual(response.relatedResults?.map(r => r.event.id), ['unknown']);
  assert.deepEqual(response.relatedResults?.[0].differences, ['Beginner suitability not listed']);
});

test('next week means next Monday through Sunday on Sunday, Monday, and across daylight saving', () => {
  for (const [at, from, to] of [
    ['2026-11-15T01:00:00-08:00', '2026-11-16T00:00:00-08:00', '2026-11-23T00:00:00-08:00'],
    ['2026-11-16T01:00:00-08:00', '2026-11-23T00:00:00-08:00', '2026-11-30T00:00:00-08:00'],
    ['2026-03-01T12:00:00-08:00', '2026-03-02T00:00:00-08:00', '2026-03-09T00:00:00-07:00'],
  ]) {
    const c = interpretWithRules('free food next week', new Date(at));
    assert.equal(c.from, from); assert.equal(c.to, to);
  }
  assert.equal(interpretWithRules('events after 12 am', now).afterMinutes, 0);
});

test('related-only suggestions retain exclusions and never pass off paid or unknown admission as free', async () => {
  fixture({ keywords: [], freeOnly: true, foodAdvertisedOnly: false });
  const response = await search('free events next week', [
    event({ id: 'unknown' }),
    event({ id: 'paid', title: 'Paid Workshop', costCents: 1000 }),
    event({ id: 'cancelled', status: 'cancelled' }),
    event({ id: 'past', startsAt: '2026-11-12T18:00:00-08:00', endsAt: '2026-11-12T19:00:00-08:00' }),
  ], now);
  assert.equal(response.noMatch, true);
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.relatedResults?.map(r => r.event.id), ['unknown', 'paid']);
  assert.deepEqual(response.relatedResults?.[0].differences, ['Admission cost not listed']);
  assert.deepEqual(response.relatedResults?.[1].differences, ['Paid admission']);
  assert.match(response.answer, /No exact matches/);
});

test('provider failure still returns honest related suggestions, without a second call', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Synthetic provider failure'); };
  const response = await search('beginner-friendly events', [event()], now);
  assert.equal(calls, 1);
  assert.equal(response.fallbackReason, 'unavailable');
  assert.equal(response.relatedResults?.[0].event.id, 'food-event');
  assert.match(response.answer, /No exact matches/);
});

test('model ranking changes only the order of provided events and ignores invented IDs', async () => {
  fixture({ keywords: [] }, { rankedIds: ['invented', 'second', 'food-event'], reasons: [{ id: 'invented', reason: 'Fake event' }] });
  const response = await search('events this week', [event(), event({ id: 'second', title: 'Art Social' })], now);
  assert.deepEqual(response.results.map(r => r.event.id), ['second', 'food-event']);
});

test('a near-campus question says when results do not list a location', async () => {
  fixture({ keywords: [], freeOnly: false, foodAdvertisedOnly: true, dateFrom: '2026-11-15', dateTo: '2026-11-22', afterTime: '00:00' });
  const hidden = await search('food events near campus this week', [event({ location: null })], now);
  assert.match(hidden.answer, /None of these list a location publicly/);
  fixture({ keywords: [], freeOnly: false, foodAdvertisedOnly: true, dateFrom: '2026-11-15', dateTo: '2026-11-22', afterTime: '00:00' });
  const placed = await search('food events near campus this week', [event({ location: 'Ginsburg Hall 101' })], now);
  assert.doesNotMatch(placed.answer, /list a location/);
});
