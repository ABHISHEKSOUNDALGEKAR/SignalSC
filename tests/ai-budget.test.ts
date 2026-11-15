import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import express from 'express';
import { ModelBudget, ModelCapacityError, readModelLimit } from '../server/model-budget';

// Isolated process: synthetic credentials, mocked provider, no app database.
process.env.MODEL_API_KEY = 'test-only';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
process.env.MODEL_REQUEST_BUDGET = '2';
process.env.MODEL_BUDGET_WINDOW_MS = '1000';
process.env.MODEL_MAX_CONCURRENT = '1';
process.env.NODE_ENV = 'development';
process.env.ORGANIZER_ACCESS_CODES = 'Budget Test=budget-test';
process.env.SESSION_SECRET = 'isolated-budget-test-secret';
delete process.env.DATABASE_URL;
let time = 10_000;
const realNow = Date.now;
// Capture a deterministic clock in the module-level admission gate.
Date.now = () => time;
const { completeJson, ModelLimitError, ModelUnavailableError } = await import('../server/model');
Date.now = realNow;
const { search } = await import('../server/search');
const { emptyDraft } = await import('../server/extract');
const { apiRouter } = await import('../server/routes');
const { createStore } = await import('../server/store');
const originalFetch = globalThis.fetch;
const reply = (value: unknown = {}) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
const now = new Date('2035-01-15T17:00:00-08:00');
const event = {
  ...emptyDraft(null), title: 'Campus gathering', id: 'fixture', status: 'published' as const,
  startsAt: '2035-01-15T18:00:00-08:00', endsAt: null, organizationName: 'Test',
  organizationId: 'test', flyerUrl: null, publishedAt: now.toISOString(),
  updatedAt: now.toISOString(), confirmation: 'organizer-confirmed' as const,
};
beforeEach(() => {
  time += 1000;
  globalThis.fetch = async () => { throw new Error('Unexpected provider call in test'); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('fixed-window budget resets at the boundary; zero budget disables calls', () => {
  let clock = 0;
  const gate = new ModelBudget(1, 100, 1, () => clock);
  gate.acquire()();
  clock = 99;
  assert.throws(() => gate.acquire(), ModelCapacityError);
  clock = 100;
  gate.acquire()();
  assert.throws(() => new ModelBudget(0, 100, 1).acquire(), ModelCapacityError);
});

test('concurrency survives window reset and release is idempotent', () => {
  let clock = 0;
  const gate = new ModelBudget(2, 100, 1, () => clock);
  const release = gate.acquire();
  clock = 100;
  assert.throws(() => gate.acquire(), /concurrency/);
  release(); release();
  const next = gate.acquire();
  assert.throws(() => gate.acquire(), /concurrency/);
  next();
  gate.acquire()();
  assert.throws(() => gate.acquire(), /budget/);
});

test('retry attempts consume request budget without taking another concurrency slot', () => {
  const gate = new ModelBudget(2, 100, 1, () => 0);
  const release = gate.acquire();
  gate.recordAttempt();
  assert.throws(() => gate.recordAttempt(), ModelCapacityError);
  assert.throws(() => gate.acquire(), /budget/);
  release();
  assert.throws(() => gate.acquire(), /budget/);
});

test('invalid configuration fails closed without echoing its value', () => {
  const name = 'TEST_MODEL_LIMIT';
  try {
    delete process.env[name];
    assert.equal(readModelLimit(name, 4, 1), 4);
    for (const value of ['secret-invalid', '', '-1', '1.5', '0', '9007199254740992']) {
      process.env[name] = value;
      assert.throws(() => readModelLimit(name, 4, 1), { message: `${name} must be an integer >= 1.` });
    }
  } finally { delete process.env[name]; }
});

test('all callers share the budget; blocked calls never fetch and recover at reset', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(); };
  await completeJson([]);
  await completeJson([]);
  await assert.rejects(completeJson([]), ModelLimitError);
  assert.equal(calls, 2);
  time += 1000;
  await completeJson([]);
  assert.equal(calls, 3);
});

test('parallel calls reject immediately without consuming an attempt', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  const first = completeJson([]);
  await assert.rejects(completeJson([]), /concurrency/);
  assert.equal(calls, 1);
  finish(reply());
  await first;
  globalThis.fetch = async () => { calls++; return reply(); };
  await completeJson([]);
  assert.equal(calls, 2);
});

test('failed and malformed provider responses release slots but spend attempts', async () => {
  globalThis.fetch = async () => { throw new Error('private source and key'); };
  await assert.rejects(completeJson([]), ModelUnavailableError);
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: 'not json' } }] });
  await assert.rejects(completeJson([]), /invalid response/);
  await assert.rejects(completeJson([]), /budget/);
  time += 1000;
  globalThis.fetch = async () => reply();
  await completeJson([]);
});

test('timeouts release concurrency without refunding the attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('private abort detail')), { once: true });
  });
  const pending = assert.rejects(completeJson([]), /timed out/);
  t.mock.timers.tick(45_000);
  await pending;
  globalThis.fetch = async () => reply();
  await completeJson([]);
  await assert.rejects(completeJson([]), /budget/);
});

test('fallback logs contain neither provider bodies nor source content', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args.join(' ')); });
  globalThis.fetch = async () => new Response('private-provider-body test-only', { status: 503 });
  const result = await search('private-source-content', [], now);
  assert.equal(result.fallbackReason, 'unavailable');
  assert.match(result.answer, /basic search matching/);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs.join(' '), /private-provider-body|private-source-content|test-only/);
});

test('exhausted search discloses basic matching for results and empty results', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(); };
  await completeJson([]); await completeJson([]);
  for (const events of [[event], []]) {
    const result = await search('tonight', events, now);
    assert.equal(result.interpretedBy, 'rules');
    assert.equal(result.fallbackReason, 'capacity');
    assert.match(result.answer, /Using basic search matching.*usage limit/);
    assert.equal(result.results.length, events.length);
  }
  assert.equal(calls, 2);
});

test('answer-stage exhaustion is disclosed without losing model interpretation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ keywords: [] }); };
  await completeJson([]); // One slot remains for interpretation, none for writing.
  const result = await search('tonight', [event], now);
  assert.equal(result.interpretedBy, 'model');
  assert.equal(result.fallbackReason, 'capacity');
  assert.match(result.answer, /Using a basic search summary.*usage limit/);
  assert.equal(result.results[0].event.id, event.id);
  assert.equal(calls, 2);
});

test('exhausted refinements keep the previous filters and never send another paid attempt', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ keywords: [] }); };
  const initial = await search('tonight', [event], now);
  assert.equal(calls, 2);
  const refined = await search('only the ones with food', [event], now, { context: initial.constraints });
  assert.equal(refined.refinementApplied, false);
  assert.equal(refined.fallbackReason, 'capacity');
  assert.deepEqual(refined.constraints, initial.constraints);
  assert.match(refined.answer, /unchanged/);
  assert.equal(calls, 2);
});

test('extraction returns 503 without saving data when search has used the budget', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ keywords: [] }); };
  await search('tonight', [event], now); // Interpretation + answer share two attempts.
  const store = createStore();
  await store.init();
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await originalFetch(`${base}/organizer/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: 'budget-test' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const response = await originalFetch(`${base}/organizer/drafts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: 'Private synthetic flyer source' }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json() as { error: string }).error, /usage limit/);
    assert.equal((await store.list({ statuses: ['draft'] })).length, 0);
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
