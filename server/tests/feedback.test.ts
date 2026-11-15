import './setup';
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

process.env.MODEL_API_KEY = 'simulated-feedback-test-key';
process.env.SESSION_SECRET = 'feedback-test-session-secret';

const { apiRouter } = await import('../routes');
const { MemoryStore, PostgresStore } = await import('../store');
const { toCampusIso } = await import('../time');

let server: Server;
let base = '';
const store = new MemoryStore();
const originalFetch = globalThis.fetch;

function makeEvent(id: string, status: 'draft' | 'published' | 'cancelled', startsAt: string, organizationId = 'test-org-a') {
  const createdAt = new Date().toISOString();
  return {
    id,
    status,
    organizationId,
    organizationName: organizationId === 'test-org-a' ? 'Test Org A' : 'Test Org B',
    data: {
      title: `Event ${id}`,
      description: '',
      startsAt,
      endsAt: toCampusIso(new Date(Date.parse(startsAt) + 60 * 60_000)),
      timezone: 'America/Los_Angeles' as const,
      location: 'Student Union',
      eligibility: null,
      costCents: null,
      food: 'unknown' as const,
      beginnerFriendly: null,
      registrationUrl: null,
      registrationDeadline: null,
      sourceUrl: null,
      sourceKind: 'flyer' as const,
      evidence: [],
      uncertainties: [],
    },
    flyerId: null,
    extractedBy: 'manual' as const,
    confirmation: status === 'published' ? 'organizer-confirmed' as const : null,
    externalId: null,
    createdAt,
    updatedAt: createdAt,
    publishedAt: status === 'published' ? createdAt : null,
  };
}

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text, headers: response.headers };
}

async function signIn(accessCode: string) {
  const response = await call('POST', '/organizer/session', { body: { accessCode } });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0].split(';')[0];
}

function feedback(eventId: string, id: string, input: Partial<{ rating: number; wouldReturn: boolean | null; comment: string; deviceKey: string; demo: boolean }> = {}) {
  return {
    id,
    eventId,
    rating: input.rating ?? 4,
    wouldReturn: input.wouldReturn === undefined ? true : input.wouldReturn,
    comment: input.comment ?? 'A useful event.',
    deviceKey: input.deviceKey ?? `device-key-${id}`,
    demo: input.demo ?? false,
    createdAt: new Date().toISOString(),
  };
}

before(async () => {
  const now = Date.now();
  await store.insert(makeEvent('feedback-started', 'published', new Date(now - 2 * 60 * 60_000).toISOString()) as any);
  await store.insert(makeEvent('feedback-future', 'published', new Date(now + 2 * 60 * 60_000).toISOString()) as any);
  await store.insert(makeEvent('feedback-draft', 'draft', new Date(now - 2 * 60 * 60_000).toISOString()) as any);
  await store.insert(makeEvent('feedback-summary-two', 'published', new Date(now - 2 * 60 * 60_000).toISOString()) as any);
  await store.insert(makeEvent('feedback-summary-good', 'published', new Date(now - 2 * 60 * 60_000).toISOString()) as any);
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', apiRouter(store));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(() => { server.close(); globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

test('public feedback accepts one response only after an event starts', async () => {
  const valid = { rating: 5, wouldReturn: true, comment: 'Great event.', deviceKey: 'device-key-1234' };
  assert.equal((await call('POST', '/events/feedback-future/feedback', { body: valid })).status, 409);
  assert.equal((await call('POST', '/events/feedback-draft/feedback', { body: valid })).status, 404);
  assert.equal((await call('POST', '/events/feedback-started/feedback', { body: { ...valid, rating: 6 } })).status, 400);
  assert.equal((await call('POST', '/events/feedback-started/feedback', { body: valid })).status, 201);
  assert.equal((await call('POST', '/events/feedback-started/feedback', { body: valid })).status, 409);
  const count = await call('GET', '/events/feedback-started/feedback/summary-available');
  assert.equal(count.status, 200);
  assert.deepEqual(count.json, { count: 1 });
});

test('organizer feedback is private, owner-checked and omits device keys', async () => {
  const entry = feedback('feedback-started', 'feedback-private-response', { comment: 'The room was easy to find.' });
  assert.equal(await store.addFeedback(entry), true);
  const owner = await signIn('code-a');
  const other = await signIn('code-b');
  assert.equal((await call('GET', '/organizer/events/feedback-started/feedback')).status, 401);
  assert.equal((await call('GET', '/organizer/events/feedback-started/feedback', { cookie: other })).status, 403);
  const response = await call('GET', '/organizer/events/feedback-started/feedback', { cookie: owner });
  assert.equal(response.status, 200);
  assert.ok(response.json.responses.some((item: { comment: string }) => item.comment === 'The room was easy to find.'));
  assert.ok(response.json.responses.every((item: Record<string, unknown>) => !('deviceKey' in item)));
  assert.equal(response.json.summary, null);
});

test('summary requires three responses', async () => {
  assert.equal(await store.addFeedback(feedback('feedback-summary-two', 'two-a')), true);
  assert.equal(await store.addFeedback(feedback('feedback-summary-two', 'two-b')), true);
  const owner = await signIn('code-a');
  const response = await call('POST', '/organizer/events/feedback-summary-two/feedback/summary', { cookie: owner });
  assert.equal(response.status, 422);
  assert.deepEqual(response.json, { error: 'Add at least 3 responses before summarizing.', count: 2 });
});

test('summary removes unsupported quotes, computes stats and preserves saved results on failure', async () => {
  const eventId = 'feedback-summary-good';
  const samples = [
    feedback(eventId, 'summary-a', { rating: 5, wouldReturn: true, comment: 'The speakers were clear and engaging. I wish there had been more time for questions.' }),
    feedback(eventId, 'summary-b', { rating: 4, wouldReturn: true, comment: 'The sign-in line moved slowly.' }),
    feedback(eventId, 'summary-c', { rating: 3, wouldReturn: false, comment: 'The room was comfortable.' }),
    feedback(eventId, 'summary-d', { rating: 4, wouldReturn: null, comment: 'More time for questions would help.' }),
  ];
  for (const sample of samples) assert.equal(await store.addFeedback(sample), true);
  const owner = await signIn('code-a');
  let modelCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(base)) return originalFetch(input, init);
    modelCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      overall: 'Attendees valued the event. Some comments requested more discussion time.',
      wentWell: [
        { point: 'The speakers were engaging.', quote: 'The speakers were clear and engaging.' },
        { point: 'Unsupported item.', quote: 'This sentence was never submitted.' },
      ],
      toImprove: [{ point: 'The sign-in line was slow.', quote: 'The sign-in line moved slowly.' }],
      requests: [{ point: 'Allow more discussion time.', count: 99, quote: 'I wish there had been more time for questions.' }],
    }) } }] });
  };
  const response = await call('POST', `/organizer/events/${eventId}/feedback/summary`, { cookie: owner });
  assert.equal(response.status, 200);
  assert.equal(modelCalls, 1);
  assert.equal(response.json.responseCount, 4);
  assert.deepEqual(response.json.summary.ratingCounts, { '1': 0, '2': 0, '3': 1, '4': 2, '5': 1 });
  assert.equal(response.json.summary.averageRating, 4);
  assert.equal(response.json.summary.wouldReturnYes, 2);
  assert.equal(response.json.summary.wouldReturnNo, 1);
  assert.equal(response.json.summary.wouldReturnUnknown, 1);
  assert.equal(response.json.summary.wentWell.length, 1);
  assert.equal(response.json.summary.requests[0].count, 1);
  const saved = await store.getMeta(`feedback-summary:${eventId}`);
  assert.equal(JSON.parse(saved!).generatedAt, response.json.generatedAt);

  globalThis.fetch = async (input, init) => String(input).startsWith(base)
    ? originalFetch(input, init)
    : new Response('private upstream detail', { status: 503 });
  const failed = await call('POST', `/organizer/events/${eventId}/feedback/summary`, { cookie: owner });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error, 'Feedback summary is temporarily unavailable. Any previous summary is unchanged.');
  assert.equal(await store.getMeta(`feedback-summary:${eventId}`), saved);
});

test('Postgres feedback storage uses atomic duplicate protection and maps stored rows', async () => {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO ts_feedback')) return { rows: [{ id: 'stored-id' }] };
      if (sql.includes('SELECT id, event_id, rating, would_return')) return { rows: [{
        id: 'stored-id', event_id: 'event-1', rating: 5, would_return: null, comment: 'Good.', device_key: 'private-device-key',
        demo: false, created_at: new Date('2026-01-01T00:00:00.000Z'),
      }] };
      return { rows: [] };
    },
  };
  const postgres = new PostgresStore(db);
  await postgres.init();
  const entry = feedback('event-1', 'stored-id');
  assert.equal(await postgres.addFeedback(entry), true);
  const rows = await postgres.listFeedback('event-1');
  assert.equal(rows[0].deviceKey, 'private-device-key');
  assert.equal(rows[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.ok(queries.some(query => query.sql.includes('UNIQUE (event_id, device_key)')));
  assert.ok(queries.some(query => query.sql.includes('CREATE INDEX IF NOT EXISTS ts_feedback_event_idx')));
  assert.ok(queries.some(query => query.sql.includes('ON CONFLICT (event_id, device_key) DO NOTHING')));
});
