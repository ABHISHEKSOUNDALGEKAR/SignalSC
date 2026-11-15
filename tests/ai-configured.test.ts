import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import express from 'express';

// Isolated test-process fixtures; never used for a real provider request.
process.env.MODEL_API_KEY = 'test-only-not-a-credential';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.NODE_ENV = 'development';
delete process.env.DATABASE_URL;
delete process.env.ORGANIZER_ACCESS_CODES;
const { completeJson, ModelUnavailableError, modelConfigured } = await import('../server/model');
const { extractDraft, emptyDraft } = await import('../server/extract');
const { search } = await import('../server/search');
const { apiRouter } = await import('../server/routes');
const { createStore } = await import('../server/store');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = new Date('2026-11-14T18:00:00Z');
const reply = (data: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(data) } }] });
const constraints = {
  keywords: [], dateFrom: '2026-11-14', dateTo: '2026-11-14',
  afterTime: '17:00', freeOnly: true, foodAdvertisedOnly: true, beginnerOnly: true,
};
const event = {
  ...emptyDraft(null), title: 'Robot Night', id: 'robot', status: 'published' as const,
  startsAt: '2026-11-14T18:00:00-08:00', endsAt: '2026-11-14T20:00:00-08:00',
  costCents: 0, food: 'advertised' as const, beginnerFriendly: true,
  organizationName: 'Robotics', organizationId: 'robotics', flyerUrl: null,
  publishedAt: now.toISOString(), updatedAt: now.toISOString(),
  confirmation: 'organizer-confirmed' as const,
};

test('text and image extraction use the OpenAI-compatible request and preserve unknowns', async () => {
  assert.equal(modelConfigured, true);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://model.test/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_object');
    assert.match(body.messages[0].content, /untrusted data/);
    assert.ok(body.messages[1].content.some((p: {type: string}) => p.type === 'image_url'));
    return reply({
      title: 'Robot Night', date: '2026-11-20', yearStated: true,
      startTime: '18:00', endTime: '20:00', location: 'TCC 450',
      evidence: [{field: 'title', excerpt: 'Robot Night'}],
    });
  };
  const result = await extractDraft({ text: 'Robot Night', imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }, now);
  assert.equal(result.extractedBy, 'model');
  assert.equal(result.draft.startsAt, '2026-11-20T18:00:00-08:00');
  assert.equal(result.draft.costCents, null);
  assert.equal(result.draft.beginnerFriendly, null);
  assert.equal(result.draft.evidence[0].excerpt, 'Robot Night');
});

test('search filters stored events deterministically and rejects invented result IDs', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? reply(constraints) : reply({
    answer: 'Robot Night fits your filters.',
    reasons: [{ id: 'robot', reason: 'Free, food advertised, beginners welcome.' }, { id: 'invented', reason: 'Ignore this.' }],
  });
  const result = await search('Free beginner events with food tonight after 5', [
    event,
    {...event, id: 'paid', costCents: 500},
    {...event, id: 'unknown-cost', costCents: null},
    {...event, id: 'unknown-food', food: 'unknown'},
    {...event, id: 'experienced', beginnerFriendly: null},
    {...event, id: 'cancelled', status: 'cancelled'},
    {...event, id: 'early', startsAt: '2026-11-14T16:00:00-08:00'},
    {...event, id: 'tomorrow', startsAt: '2026-11-15T18:00:00-08:00'},
  ], now);
  assert.equal(result.interpretedBy, 'model');
  assert.deepEqual(result.results.map(r => r.event.id), ['robot']);
  assert.equal(result.constraints.afterMinutes, 1020);
  assert.equal(result.excluded.reduce((n, e) => n + e.count, 0), 5);
});

test('no-match answer does not ask the model to invent events', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(constraints); };
  const result = await search('Free events tonight', [], now);
  assert.equal(result.noMatch, true);
  assert.deepEqual(result.results, []);
  assert.equal(calls, 1);
});

test('HTTP failures are sanitized, extraction rejects, and search falls back to rules', async () => {
  for (const status of [401, 429, 503]) {
    globalThis.fetch = async () => new Response('private provider body', {status});
    await assert.rejects(completeJson([]), (e: Error) => {
      assert.ok(e instanceof ModelUnavailableError);
      assert.match(e.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(e.message, /private provider body/);
      return true;
    });
    await assert.rejects(extractDraft({text: 'Robot Night'}, now), ModelUnavailableError);
    const result = await search('free beginner events with food tonight after 5', [event, {...event, id:'paid', costCents:500}], now);
    assert.equal(result.interpretedBy, 'rules');
    assert.deepEqual(result.results.map(r => r.event.id), ['robot']);
  }
});

test('network and malformed JSON errors are normalized; invalid extraction becomes manual', async () => {
  globalThis.fetch = async () => { throw new Error('private network detail'); };
  await assert.rejects(completeJson([]), /could not be reached/);
  globalThis.fetch = async () => Response.json({choices:[{message:{content:'not JSON'}}]});
  await assert.rejects(completeJson([]), ModelUnavailableError);
  globalThis.fetch = async () => reply(null);
  assert.equal((await extractDraft({text:'Robot Night'}, now)).extractedBy, 'manual');
});

test('organizer extraction endpoint returns 503 without saving a draft on provider failure', async () => {
  const store = createStore();
  await store.init();
  const app = express().use(express.json()).use('/api', apiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as {port: number};
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const login = await originalFetch(`${base}/organizer/session`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({accessCode:'demo-a'}),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    globalThis.fetch = async () => new Response('private upstream error', {status:503});
    const response = await originalFetch(`${base}/organizer/drafts`, {
      method:'POST', headers:{'Content-Type':'application/json', Cookie:cookie}, body:JSON.stringify({text:'Robot Night'}),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /temporarily unavailable/);
    assert.equal((await store.list({statuses:['draft']})).length, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
