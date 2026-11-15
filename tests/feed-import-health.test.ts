import assert from 'node:assert/strict';
import { test } from 'node:test';

delete process.env.DATABASE_URL;
delete process.env.MODEL_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const { MemoryStore } = await import('../server/store');
const { importFeed } = await import('../server/importer');
const { readImportHealth } = await import('../server/import-health');

const feedUrl = 'https://feed.test/private-calendar?access_token=private-value';
const now = new Date('2035-01-01T00:00:00.000Z');
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:feed-health-event',
  'SUMMARY:Campus meetup',
  'DTSTART:20350102T180000Z',
  'DTEND:20350102T190000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('simulated feed HTTP failure records a safe fetch category without changing recovery health', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = new MemoryStore();
  globalThis.fetch = async () => new Response('private upstream response', { status: 503 });

  await assert.rejects(importFeed(store, feedUrl, now), /Feed request failed/);
  const health = await readImportHealth(store, now.getTime());
  assert.equal(health.runs.length, 0, 'feed failure must not be written as AI recovery');
  assert.deepEqual(health.feedImports[0], {
    source: 'engagesc',
    lastAttemptAt: now.toISOString(),
    lastCompletedAt: null,
    freshness: 'never',
    consecutiveFailures: 1,
    lastFailureCategory: 'request_failed',
    fetch: { status: 'failed', failureCategory: 'request_failed' },
    eventSave: { status: 'not_attempted', failureCategory: null },
  });
  assert.doesNotMatch(JSON.stringify(health), /private-value|private upstream response|feed\.test/i);
});

test('simulated HTTP import preserves last completion and reports event-save failure separately', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = new MemoryStore();
  globalThis.fetch = async () => new Response(ics, { status: 200 });

  await importFeed(store, feedUrl, now);
  const completedAt = (await readImportHealth(store, now.getTime())).feedImports[0].lastCompletedAt;
  assert.equal(completedAt, now.toISOString());

  store.upsertImported = async () => { throw new Error('private database connection details'); };
  await assert.rejects(importFeed(store, feedUrl, new Date(now.getTime() + 60 * 60_000)), /private database connection details/);
  const health = await readImportHealth(store, now.getTime() + 60 * 60_000);
  assert.deepEqual(health.feedImports[0], {
    source: 'engagesc',
    lastAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    lastCompletedAt: completedAt,
    freshness: 'fresh',
    consecutiveFailures: 1,
    lastFailureCategory: 'event_save_failed',
    fetch: { status: 'succeeded', failureCategory: null },
    eventSave: { status: 'failed', failureCategory: 'event_save_failed' },
  });
  assert.doesNotMatch(JSON.stringify(health), /private-value|private database connection details|feed\.test/i);
});

test('simulated HTTP response with invalid calendar content is not marked as a completed import', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = new MemoryStore();
  globalThis.fetch = async () => new Response('<html>temporarily unavailable</html>', { status: 200 });

  await assert.rejects(importFeed(store, feedUrl, now), /Feed content could not be read/);
  const health = await readImportHealth(store, now.getTime());
  assert.equal(health.feedImports[0].fetch.failureCategory, 'invalid_feed');
  assert.equal(health.feedImports[0].lastCompletedAt, null);
  assert.equal(health.feedImports[0].eventSave.status, 'not_attempted');
});

test('repeated safe failure counts rise once per failed attempt and reset only after a completed recovery', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = new MemoryStore();
  const failed = async (status: number, body: string, at: Date) => {
    globalThis.fetch = async () => new Response(body, { status });
    await assert.rejects(importFeed(store, feedUrl, at));
    return (await readImportHealth(store, at.getTime())).feedImports[0];
  };
  const first = await failed(503, 'private detail', now);
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(first.lastFailureCategory, 'request_failed');
  const repeated = await failed(503, 'different private detail', new Date(now.getTime() + 60_000));
  assert.equal(repeated.consecutiveFailures, 2);
  assert.equal(repeated.lastFailureCategory, 'request_failed');
  const changed = await failed(200, '<html>private proxy page</html>', new Date(now.getTime() + 120_000));
  assert.equal(changed.consecutiveFailures, 3);
  assert.equal(changed.lastFailureCategory, 'invalid_feed');
  const oneMoreCheck = new Date(now.getTime() + 180_000);
  globalThis.fetch = async () => new Response(ics, { status: 200 });
  await importFeed(store, feedUrl, oneMoreCheck);
  const recovered = (await readImportHealth(store, oneMoreCheck.getTime())).feedImports[0];
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.lastFailureCategory, null);
  assert.equal(recovered.freshness, 'fresh');
  assert.equal(recovered.lastCompletedAt, oneMoreCheck.toISOString());
  const afterRecovery = await failed(503, 'not exposed', new Date(now.getTime() + 240_000));
  assert.equal(afterRecovery.consecutiveFailures, 1);
  assert.equal(afterRecovery.lastFailureCategory, 'request_failed');
  assert.doesNotMatch(JSON.stringify([first, repeated, changed, recovered, afterRecovery]), /private detail|proxy page|feed\.test|access_token/);
});
