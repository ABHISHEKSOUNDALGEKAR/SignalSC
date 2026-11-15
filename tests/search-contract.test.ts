import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
process.env.NODE_ENV = 'development';
delete process.env.REPLIT_DEPLOYMENT;
delete process.env.MODEL_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
delete process.env.DATABASE_URL;
const { apiRouter } = await import('../server/routes');
const { MemoryStore } = await import('../server/store');
const { interpretWithRules } = await import('../server/search');

test('HTTP search accepts structured context without writes or caching and rejects malformed updates', async t => {
  const store = new MemoryStore();
  await store.init();
  // Search should only read published events; any store mutation would fail this test.
  for (const name of Object.getOwnPropertyNames(MemoryStore.prototype)) {
    if (/^(save|put|set|delete|update|create|insert|upsert|add)/i.test(name)) {
      t.mock.method(store, name as keyof MemoryStore, (() => { throw new Error('Search must not persist data'); }) as never);
    }
  }
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const now = '2026-11-15T01:00:00-08:00';
  const context = interpretWithRules('free food tonight', new Date(now));
  const send = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await send({ query: 'later in the evening', context, now });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result.constraints, context);
  assert.equal(result.refinementApplied, false);
  assert.equal(JSON.stringify(result).includes('later in the evening'), false);
  const edited = await send({ constraints: { ...context, foodAdvertisedOnly: false }, now });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).constraints.foodAdvertisedOnly, false);
  for (const body of [
    { query: 'later', context: { ...context, afterMinutes: -1 } },
    { query: 'later', context: { ...context, from: context.to } },
    { query: 'later', context, constraints: context },
    { query: 'later', conversation: ['earlier raw text'] },
  ]) assert.equal((await send(body)).status, 400);
});
