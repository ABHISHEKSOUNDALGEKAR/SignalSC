import assert from 'node:assert/strict';
import { test } from 'node:test';

delete process.env.DATABASE_URL;
delete process.env.MODEL_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const { MemoryStore } = await import('../server/store');
const { importHealthRecorder, readImportHealth } = await import('../server/import-health');

test('recovery summaries preserve last success, fence older runs, and keep calendars separate', async () => {
  const store = new MemoryStore();
  const successAt = new Date('2035-01-01T00:00:00Z');
  const success = importHealthRecorder(store, 'engagesc', successAt);
  success.add('recovered', 4);
  success.success(successAt.getTime());
  await success.save();
  const failed = importHealthRecorder(Object.create(store), 'engagesc', new Date('2035-01-02T00:00:00Z'));
  failed.add('provider_failure', 4, Date.parse('2035-01-03T00:00:00Z'));
  await failed.save();
  const stale = importHealthRecorder(store, 'engagesc', new Date('2034-12-31T00:00:00Z'));
  stale.add('capacity', 10, 0);
  await stale.save();
  const other = importHealthRecorder(store, 'usc-calendar', successAt);
  other.add('oversized', 2);
  await other.save();
  const health = await readImportHealth(Object.create(store));
  assert.equal(health.runs.length, 2);
  assert.equal(health.runs[0].checkedAt, '2035-01-02T00:00:00.000Z');
  assert.equal(health.runs[0].lastSuccessAt, successAt.toISOString());
  assert.equal(health.runs[0].eventCount, 4);
  assert.equal(health.runs[0].outcomes[0].outcome, 'provider_failure');
  assert.equal(health.runs[1].lastSuccessAt, null);
  assert.equal(health.runs[1].eventCount, 2);
});

test('unavailable or corrupt health is explicit and a later pass repairs corrupt summaries', async t => {
  const store = new MemoryStore();
  await store.setMeta('import-health:v1:engagesc', 'not-json');
  await assert.rejects(readImportHealth(store));
  const repaired = importHealthRecorder(store, 'engagesc', new Date());
  repaired.add('not_configured', 1, 0);
  await repaired.save();
  assert.equal((await readImportHealth(store)).runs[0].eventCount, 1);
  const logs: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args.join(' ')));
  store.getMetaSnapshot = async () => { throw new Error('private-driver-credentials'); };
  await repaired.save();
  assert.doesNotMatch(logs.join(' '), /private-driver-credentials/);
  store.getMeta = async () => { throw new Error('private-driver-credentials'); };
  await assert.rejects(readImportHealth(store));
});
