import './setup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { emptyDraft } from '../extract';
import { apiRouter } from '../routes';
import { MemoryStore, type StoredEvent } from '../store';

test('past titles are searchable only on request and their feedback remains usable', async t => {
  const store = new MemoryStore();
  const now = Date.now();
  const record = (id: string, days: number, status: StoredEvent['status'] = 'published'): StoredEvent => ({
    id, status, organizationId: null, organizationName: 'Public Org',
    data: {
      ...emptyDraft(null), title: 'BSA Weekly General Body Meeting',
      description: 'Description keyword should not match an archived title search.',
      startsAt: new Date(now + days * 86_400_000).toISOString(),
      endsAt: new Date(now + days * 86_400_000 + 3_600_000).toISOString(),
    },
    flyerId: null, extractedBy: 'manual', confirmation: 'source-imported', externalId: null,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), publishedAt: new Date(now).toISOString(),
  });
  for (const item of [record('upcoming', 2), record('past', -3), record('cancelled', -2, 'cancelled'), record('draft', -2, 'draft')]) {
    await store.insert(item);
  }
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const ids = async (query: string) => {
    const response = await fetch(`${base}/events${query}`);
    assert.equal(response.status, 200);
    return ((await response.json()).events as { id: string }[]).map(item => item.id);
  };
  assert.deepEqual(await ids(''), ['upcoming']);
  assert.deepEqual(await ids('?scope=all'), ['upcoming']);
  assert.deepEqual(await ids('?q=BSA'), ['upcoming']);
  assert.deepEqual(await ids('?scope=all&q=meeting%20BSA'), ['past', 'upcoming']);
  assert.deepEqual(await ids('?scope=all&q=Description'), []);
  assert.deepEqual(await ids('?scope=all&q=BSA&food=1'), []);
  assert.deepEqual(await ids(`?scope=all&q=BSA&from=${encodeURIComponent(new Date(now).toISOString())}`), ['upcoming']);
  assert.equal((await fetch(`${base}/events?q=${'a'.repeat(121)}`)).status, 400);
  assert.equal((await fetch(`${base}/events/past`)).status, 200);
  const feedback = await fetch(`${base}/events/past/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5, wouldReturn: true, comment: 'Great event.', deviceKey: 'archive-test-device' }),
  });
  assert.equal(feedback.status, 201);
  assert.equal((await store.listFeedback('past')).length, 1);
});
