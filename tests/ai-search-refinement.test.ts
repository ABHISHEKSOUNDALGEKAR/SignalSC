import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { EventRecord, SearchConstraints } from '../shared/api';
import { searchRequestSchema } from '../shared/api';

process.env.MODEL_API_KEY = 'isolated-refinement-test';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_NAME = 'refinement-fixture';
const { search, interpretWithRules } = await import('../server/search');
const { emptyDraft } = await import('../server/extract');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = new Date('2026-11-15T01:00:00-08:00');
const initial = (): SearchConstraints => ({
  ...interpretWithRules('robotics tonight after 5', now), freeOnly: true, beginnerOnly: true,
});
const events: EventRecord[] = [
  { ...emptyDraft(null), id: 'later', title: 'Robotics Dinner', description: 'Robotics with dinner',
    startsAt: '2026-11-17T20:00:00-08:00', endsAt: null, status: 'published',
    food: 'advertised', costCents: 0, beginnerFriendly: true, organizationName: 'Fixtures',
    flyerUrl: null, publishedAt: now.toISOString(), updatedAt: now.toISOString() },
  { ...emptyDraft(null), id: 'no-food', title: 'Robotics Workshop', description: 'Robotics',
    startsAt: '2026-11-17T18:00:00-08:00', endsAt: null, status: 'published',
    food: 'unknown', costCents: 0, beginnerFriendly: true, organizationName: 'Fixtures',
    flyerUrl: null, publishedAt: now.toISOString(), updatedAt: now.toISOString() },
];
function provider(patch: unknown) {
  const bodies: { messages: { content: string }[] }[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: JSON.stringify(bodies.length === 1
      ? patch : { answer: 'Confirmed event choices.', reasons: [], rankedIds: [] }) } }] });
  };
  return bodies;
}

test('multi-turn updates replace dates, preserve interests and other filters, then add food and later time', async () => {
  const context = initial();
  const before = structuredClone(context);
  const calls = provider({ from: '2026-11-15T00:00:00-08:00', to: '2026-11-16T00:00:00-08:00' });
  const nextWeek = await search('next week instead', events, now, { context });
  assert.equal(nextWeek.refinementApplied, true);
  assert.deepEqual(context, before);
  assert.equal(nextWeek.constraints.from, '2026-11-16T00:00:00-08:00');
  assert.equal(nextWeek.constraints.to, '2026-11-23T00:00:00-08:00');
  assert.equal(nextWeek.constraints.freeOnly, true);
  assert.equal(nextWeek.constraints.beginnerOnly, true);
  assert.deepEqual(nextWeek.constraints.keywords, ['robotics']);
  assert.equal(nextWeek.results.length, 2);
  assert.deepEqual(JSON.parse(calls[0].messages[1].content).constraints, context);
  provider({ foodAdvertisedOnly: true });
  const food = await search('only the ones with food', events, now, { context: nextWeek.constraints });
  assert.deepEqual(food.results.map(r => r.event.id), ['later']);
  assert.deepEqual(food.relatedResults?.[0].differences, ['Food not confirmed']);
  provider({ afterMinutes: 1080 });
  const later = await search('later in the evening', events, now, { context: food.constraints });
  assert.equal(later.constraints.afterMinutes, 1140);
  assert.equal(later.constraints.foodAdvertisedOnly, true);
  assert.deepEqual(later.results.map(r => r.event.id), ['later']);
});

test('filters can be removed without resurrecting them from earlier questions', async () => {
  provider({ freeOnly: false, foodAdvertisedOnly: false, beginnerOnly: false, afterMinutes: null, keywords: [] });
  const result = await search('remove all food, cost, beginner, time and topic filters', events, now,
    { context: { ...initial(), foodAdvertisedOnly: true } });
  assert.deepEqual(result.constraints, { ...initial(), freeOnly: false, foodAdvertisedOnly: false,
    beginnerOnly: false, afterMinutes: null, keywords: [] });
});

test('changed dates across daylight saving use campus midnights', async () => {
  const at = new Date('2026-03-01T12:00:00-08:00');
  provider({ from: '2026-03-02T00:00:00-08:00', to: '2026-03-09T00:00:00-08:00' });
  const result = await search('next week instead', [], at, { context: interpretWithRules('today', at) });
  assert.equal(result.constraints.to, '2026-03-09T00:00:00-07:00');
});

test('outages and invalid model patches leave all constraints unchanged and disclose failure', async () => {
  for (const patch of [{ freeOnly: 'false' }, { afterMinutes: 1440 }, { keywords: ['x'.repeat(61)] },
    { from: '2026-12-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
    { to: '2028-01-01T00:00:00Z' }, { unrelated: true }, {}]) {
    const calls = provider(patch);
    const result = await search('change my filters', events, now, { context: initial() });
    assert.equal(result.refinementApplied, false);
    assert.deepEqual(result.constraints, initial());
    assert.equal(calls.length, 1);
    assert.match(result.answer, /unchanged/);
  }
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Synthetic outage'); };
  const result = await search('only the ones with food', events, now, { context: initial() });
  assert.equal(result.fallbackReason, 'unavailable');
  assert.equal(result.refinementApplied, false);
  assert.deepEqual(result.constraints, initial());
  assert.equal(calls, 1);
});

test('manual edits work without any AI request, and independent searches do not inherit context', async () => {
  globalThis.fetch = async () => { throw new Error('Must not call provider for manual edits'); };
  const constraints = { ...interpretWithRules('next week', now), foodAdvertisedOnly: true };
  const edited = await search('', events, now, { constraints });
  assert.deepEqual(edited.constraints, constraints);
  assert.equal(edited.fallbackReason, undefined);
  assert.deepEqual(edited.results.map(r => r.event.id), ['later']);
  provider({ keywords: [], freeOnly: false });
  const fresh = await search('events next week', events, now);
  assert.equal(fresh.constraints.foodAdvertisedOnly, false);
  assert.equal(fresh.constraints.beginnerOnly, false);
});

test('request contract rejects invalid context, raw history, conflicting modes and unbounded windows', () => {
  for (const body of [
    { query: 'hello', context: { ...initial(), freeOnly: 'yes' } },
    { query: 'hello', context: { ...initial(), to: initial().from } },
    { query: 'hello', context: { ...initial(), to: '2030-01-01T00:00:00Z' } },
    { query: 'hello', context: initial(), constraints: initial() },
    { query: 'hello', history: ['private previous conversation'] },
    { query: '' },
  ]) assert.equal(searchRequestSchema.safeParse(body).success, false);
  assert.equal(searchRequestSchema.safeParse({ query: 'later', context: initial() }).success, true);
  assert.equal(searchRequestSchema.safeParse({ constraints: initial() }).success, true);
});
