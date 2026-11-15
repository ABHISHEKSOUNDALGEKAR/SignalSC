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
