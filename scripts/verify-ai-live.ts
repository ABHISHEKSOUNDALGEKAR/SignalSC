import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import type { EventDraft } from '../shared/events';
import type { SearchResponse } from '../shared/api';
import type { StoredEvent } from '../server/store';

// Opt-in only: this script spends real provider credits. Fixtures never enter
// the running app or its database, and actual organizer credentials are unused.
if (!process.argv.includes('--confirm-live')) {
  throw new Error('Live checks use provider credits. Run npm run test:ai:live -- --confirm-live');
}
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
process.env.ORGANIZER_ACCESS_CODES = 'Live Test=isolated-live-test';
process.env.SESSION_SECRET = 'isolated-live-verification-session';

const { extractDraft, emptyDraft } = await import('../server/extract');
const { modelConfigured } = await import('../server/model');
const { apiRouter } = await import('../server/routes');
const { createStore } = await import('../server/store');
assert.equal(modelConfigured, true, 'A provider key must be configured');

// Observe real responses without replacing them. Count successful JSON model
// completions so rule/template fallbacks cannot be mistaken for live success.
const networkFetch = globalThis.fetch;
let completions = 0;
globalThis.fetch = async (input, init) => {
  const response = await networkFetch(input, init);
  if (String(input).endsWith('/chat/completions')) {
    assert.equal(response.status, 200, `Live provider returned HTTP ${response.status}`);
    const body = await response.clone().json();
    assert.equal(body.choices?.[0]?.finish_reason, 'stop', 'Model output must not be truncated');
    JSON.parse(body.choices?.[0]?.message?.content ?? '');
    completions++;
  }
  return response;
};

const now = new Date('2026-11-20T12:00:00-08:00');
const known = await extractDraft({ text: 'Robotics Night. November 20, 2026, 6:30 PM to 8:00 PM. Leavey Library. Free admission. Pizza provided. Beginners welcome. Open to all. RSVP https://example.com/rsvp' }, now);
assert.equal(known.extractedBy, 'model');
assert.equal(known.draft.title, 'Robotics Night');
assert.equal(known.draft.startsAt, '2026-11-20T18:30:00-08:00');
assert.equal(known.draft.endsAt, '2026-11-20T20:00:00-08:00');
assert.equal(known.draft.location, 'Leavey Library');
assert.equal(known.draft.costCents, 0);
assert.equal(known.draft.food, 'advertised');
assert.equal(known.draft.beginnerFriendly, true);
assert.match(known.draft.eligibility ?? '', /open to all/i);
assert.equal(known.draft.registrationUrl, 'https://example.com/rsvp');
assert.equal(known.draft.registrationDeadline, null);
assert.ok(known.draft.evidence.length);
console.log('PASS live text extraction: printed facts and source evidence');

function assertUnknown(draft: EventDraft) {
  for (const field of ['endsAt', 'eligibility', 'costCents', 'beginnerFriendly', 'registrationUrl', 'registrationDeadline'] as const) {
    assert.equal(draft[field], null, `${field} must remain unknown`);
  }
  assert.notEqual(draft.food, 'advertised', 'Absent food offers must not be invented');
}
const sparse = await extractDraft({ text: 'Mystery Meetup' }, now);
assert.equal(sparse.extractedBy, 'model');
assertUnknown(sparse.draft);
assert.equal(sparse.draft.startsAt, null);
assert.equal(sparse.draft.location, null);
console.log('PASS live sparse text: missing facts stay unknown');

const image = await readFile(new URL('../tests/fixtures/live-flyer.png', import.meta.url));
const visual = await extractDraft({ imageBase64: image.toString('base64'), mimeType: 'image/png' }, now);
assert.equal(visual.extractedBy, 'model');
assert.equal(visual.draft.title, 'Signals Study Jam');
assert.equal(visual.draft.startsAt, '2026-11-20T19:00:00-08:00');
assert.equal(visual.draft.location, 'Leavey Library');
assertUnknown(visual.draft);
assert.ok(visual.draft.evidence.length);
console.log('PASS live image-only extraction: actual PNG reading and unknown fields');

const store = createStore();
assert.equal(store.mode, 'memory', 'Never write live verification fixtures to a database');
await store.init();
const makeRecord = (id: string, data: Partial<EventDraft> = {}, status: StoredEvent['status'] = 'published'): StoredEvent => ({
  id, status, data: { ...known.draft, ...data }, organizationId: 'live-test', organizationName: 'Test Robotics',
  flyerId: null, extractedBy: 'model', confirmation: 'organizer-confirmed', externalId: null,
  createdAt: now.toISOString(), updatedAt: now.toISOString(), publishedAt: status === 'published' ? now.toISOString() : null,
});
await store.insert(makeRecord('eligible'));
await store.insert(makeRecord('paid', { costCents: 500 }));
await store.insert(makeRecord('unknown-cost', { costCents: null }));
await store.insert(makeRecord('no-food', { food: 'not-advertised' }));
await store.insert(makeRecord('unknown-food', { food: 'unknown' }));
await store.insert(makeRecord('unknown-beginner', { beginnerFriendly: null }));
await store.insert(makeRecord('early', { startsAt: '2026-11-20T16:00:00-08:00', endsAt: '2026-11-20T16:30:00-08:00' }));
await store.insert(makeRecord('tomorrow', { startsAt: '2026-11-21T18:30:00-08:00', endsAt: null }));
await store.insert(makeRecord('past', { startsAt: '2026-11-19T18:30:00-08:00', endsAt: null }));
await store.insert(makeRecord('cancelled', {}, 'cancelled'));
await store.insert(makeRecord('draft', {}, 'draft'));
await store.insert(makeRecord('astronomy', {
  ...emptyDraft(null), title: 'Astronomy Circle', description: 'An astronomy gathering.',
  startsAt: '2026-11-20T19:00:00-08:00',
}));

const app = express().use(express.json()).use('/api', apiRouter(store));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api`;
async function ask(query: string): Promise<SearchResponse> {
  const response = await networkFetch(`${base}/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, now: now.toISOString() }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  const health = await (await networkFetch(`${base}/health`)).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.modelConfigured, true);

  const beforeSearch = completions;
  const constrained = await ask('Find free robotics events with food tonight after 5 PM that explicitly welcome beginners.');
  assert.equal(constrained.interpretedBy, 'model');
  assert.equal(constrained.constraints.freeOnly, true);
  assert.equal(constrained.constraints.foodAdvertisedOnly, true);
  assert.equal(constrained.constraints.beginnerOnly, true);
  assert.equal(constrained.constraints.afterMinutes, 1020);
  assert.deepEqual(constrained.results.map(r => r.event.id), ['eligible']);
  assert.equal(completions - beforeSearch, 2, 'Interpretation AND answer must use the real provider');
  assert.match(constrained.answer, /Robotics Night/i);
  assert.doesNotMatch(constrained.answer, /^Found \d+ matching/);
  console.log('PASS live constrained interpretation and answer:', JSON.stringify({
    constraints: constrained.constraints, ids: constrained.results.map(r => r.event.id),
    answer: constrained.answer, reasons: constrained.results.map(r => r.reason),
  }));

  const beforeUnknown = completions;
  const unknown = await ask('What astronomy events are happening tonight?');
  assert.equal(unknown.interpretedBy, 'model');
  assert.deepEqual(unknown.results.map(r => r.event.id), ['astronomy']);
  assert.equal(completions - beforeUnknown, 2);
  assertUnknown(unknown.results[0].event);
  const prose = [unknown.answer, ...unknown.results.map(r => r.reason)].join(' ');
  assert.doesNotMatch(prose, /\b(?:is free|free admission|beginners welcome|USC students only|at Leavey)\b/i);
  console.log('PASS live answer with missing facts:', JSON.stringify({ answer: unknown.answer, reasons: unknown.results.map(r => r.reason) }));

  const beforeEmpty = completions;
  const noMatch = await ask('Find free astronomy events tonight.');
  assert.equal(noMatch.interpretedBy, 'model');
  assert.equal(noMatch.noMatch, true);
  assert.deepEqual(noMatch.results, []);
  assert.equal(completions - beforeEmpty, 1, 'No-match must not ask the model to invent an answer');
  console.log('PASS live no-match: unknown cost excluded; no invented event or answer call');
  console.log(`PASS live verification complete: ${completions} real JSON completions; isolated fixtures only`);
} finally {
  globalThis.fetch = networkFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
