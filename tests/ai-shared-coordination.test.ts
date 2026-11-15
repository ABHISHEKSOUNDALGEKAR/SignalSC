import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { MemoryStore, PostgresStore } from '../server/store';
import { SharedModelBudget } from '../server/shared-model-budget';
import { claimImportCache, IMPORT_LEASE_MS } from '../server/import-cache';

process.env.MODEL_API_KEY = 'synthetic-coordination-test';
process.env.MODEL_BASE_URL = 'https://model.test/v1';
delete process.env.DATABASE_URL;
const { enrichImportedEvents } = await import('../server/import-enrichment');
const { emptyDraft } = await import('../server/extract');
const run = promisify(execFile);
const hasPostgres = spawnSync('initdb', ['--version']).status === 0;
let directory: string;
let url: string;
let pools: pg.Pool[] = [];
let first: PostgresStore;
let second: PostgresStore;
const originalFetch = globalThis.fetch;

before(async () => {
  if (!hasPostgres) return;
  directory = await mkdtemp(path.join(tmpdir(), 'signalsc-coordination-'));
  await run('initdb', ['-D', path.join(directory, 'data'), '-A', 'trust', '-U', 'coordination_test', '--no-locale']);
  await run('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'postgres.log'),
    '-o', `-k ${directory} -c listen_addresses='' -c fsync=off`, '-w', 'start']);
  url = `postgresql://coordination_test@localhost/postgres?host=${encodeURIComponent(directory)}`;
  pools = [new pg.Pool({ connectionString: url }), new pg.Pool({ connectionString: url })];
  first = new PostgresStore(pools[0]);
  second = new PostgresStore(pools[1]);
  await first.init();
});
beforeEach(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected provider call'); };
  if (hasPostgres) await pools[0].query('TRUNCATE ts_meta');
});
after(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(pools.map(pool => pool.end()));
  if (directory) {
    execFileSync('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
    await rm(directory, { recursive: true, force: true });
  }
});
const pgTest = { skip: !hasPostgres && 'PostgreSQL binaries required for disposable integration database' };
const stateKey = 'model-admission:v1';
async function editBudget(edit: (state: Record<string, any>) => void) {
  const state = JSON.parse((await first.getMeta(stateKey))!);
  edit(state);
  await first.setMeta(stateKey, JSON.stringify(state));
}
const worker = async (mode = '') => {
  try {
    const result = await run(process.execPath, ['--import', 'tsx', 'tests/fixtures/coordination-worker.ts', mode], {
      env: { ...process.env, DATABASE_URL: url, MODEL_API_KEY: 'synthetic-worker',
        MODEL_REQUEST_BUDGET: '2', MODEL_BUDGET_WINDOW_MS: '3600000', MODEL_MAX_CONCURRENT: '1' },
    });
    return JSON.parse(result.stdout.trim()) as { calls: number; accepted: boolean; error?: string };
  } catch (error) {
    if (mode !== 'crash' && mode !== 'import-crash') throw error;
    assert.equal((error as { code: number }).code, 23);
    assert.match((error as { stdout: string }).stdout, /outbound-attempt/);
    return { calls: 1, accepted: true };
  }
};

test('shared counters count retries and failures, reset at the boundary, and preserve live concurrency', async () => {
  let now = Date.now();
  const store = new MemoryStore(() => now);
  const a = new SharedModelBudget(store, 2, 100, 1);
  const b = new SharedModelBudget(Object.create(store), 2, 100, 1);
  const admission = await a.acquire();
  await admission.recordAttempt();
  await assert.rejects(b.acquire(), /budget/);
  now += 100;
  await assert.rejects(b.acquire(), /concurrency/);
  await admission.recordAttempt();
  await admission.release();
  await admission.release();
  const next = await b.acquire();
  await next.release();
  await assert.rejects(a.acquire(), /budget/);
  await assert.rejects(new SharedModelBudget(new MemoryStore(), 0, 100, 1).acquire(), /budget/);
});

test('independent PostgreSQL stores atomically admit at most the shared concurrency and request limits', pgTest, async () => {
  const a = new SharedModelBudget(first, 3, 3600000, 2);
  const b = new SharedModelBudget(second, 3, 3600000, 2);
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).acquire()));
  const accepted = results.filter(r => r.status === 'fulfilled');
  assert.equal(accepted.length, 2);
  assert.equal(JSON.parse((await first.getMeta(stateKey))!).used, 2);
  for (const result of accepted) if (result.status === 'fulfilled') await result.value.release();
  const last = await b.acquire();
  await last.release();
  await assert.rejects(a.acquire(), /budget/);
  await editBudget(s => { s.resetAt = Date.now() - 1; });
  await (await b.acquire()).release();
  assert.equal(JSON.parse((await first.getMeta(stateKey))!).used, 1);
});

test('a crashed process spends its attempt; restarting cannot bypass budget or an unexpired slot', pgTest, async () => {
  await worker('crash');
  assert.deepEqual(await worker(), { calls: 0, accepted: false, error: 'Model concurrency limit is reached.' });
  await editBudget(s => { s.active[0].until = Date.now() - 1; });
  assert.deepEqual(await worker(), { calls: 1, accepted: true });
  assert.deepEqual(await worker(), { calls: 0, accepted: false, error: 'Model request budget is exhausted.' });
  assert.equal(JSON.parse((await first.getMeta(stateKey))!).used, 2);
});

test('coordination errors and mismatched settings fail closed before a simulated outbound call', pgTest, async () => {
  await (await new SharedModelBudget(first, 2, 3600000, 1).acquire()).release();
  await assert.rejects(new SharedModelBudget(second, 200, 3600000, 1).acquire(), /settings differ/);
  await first.setMeta(stateKey, 'corrupt');
  const result = await worker();
  assert.equal(result.calls, 0);
  assert.match(result.error!, /admission is unavailable/);
});

test('shared provider failures, invalid responses and awaited retries spend every outbound attempt', pgTest, async () => {
  assert.equal((await worker('http-failure')).calls, 1);
  assert.equal((await worker('invalid')).calls, 1);
  assert.equal((await worker()).calls, 0);
  await editBudget(s => { s.resetAt = Date.now() - 1; });
  assert.deepEqual(await worker('retry'), { calls: 2, accepted: true });
  assert.equal((await worker()).calls, 0);
});

test('a process killed during enrichment leaves a cooldown that survives a restart and expired lease', pgTest, async () => {
  await worker('import-crash');
  const result = await pools[0].query("SELECT key, value FROM ts_meta WHERE key LIKE 'import-details:%'");
  assert.equal(result.rows.length, 1);
  const { key } = result.rows[0];
  const value = JSON.parse(result.rows[0].value);
  assert.ok(value.retryAt > Date.now());
  value.until = Date.now() - 1;
  await first.setMeta(key, JSON.stringify(value));
  assert.deepEqual(await worker('import-again'), { calls: 0, accepted: true });
  assert.equal(JSON.parse((await first.getMeta(stateKey))!).used, 1);
});

test('simultaneous imports through independent PostgreSQL stores send only one simulated provider batch', pgTest, async () => {
  const input = () => ({ draft: { ...emptyDraft(null), title: 'Robotics', description: 'Free food is provided.' } });
  let calls = 0;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  globalThis.fetch = async () => {
    calls++;
    entered();
    await held;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ events: [{
      id: 0, food: 'advertised', evidence: [{ field: 'food', excerpt: 'Free food is provided.' }], conflicts: [],
    }] }) } }] });
  };
  const one = input();
  const pending = enrichImportedEvents(first, [one]);
  await started;
  await enrichImportedEvents(second, [input()]);
  assert.equal(calls, 1);
  finish();
  await pending;
  const later = input();
  await enrichImportedEvents(new PostgresStore(pools[1]), [later]);
  assert.equal(calls, 1);
  assert.equal(one.draft.food, 'advertised');
  assert.equal(later.draft.food, 'advertised');
});

test('cache lease expiry recovers pre-send crashes and fences stale completion and cleanup', pgTest, async () => {
  const old = await claimImportCache(first, 'lease');
  assert.equal(old.kind, 'owned');
  assert.equal((await claimImportCache(second, 'lease')).kind, 'busy');
  // Simulate elapsed database time without a minute-long test delay.
  const value = JSON.parse((await first.getMeta('lease'))!);
  value.until = Date.now() - 1;
  await first.setMeta('lease', JSON.stringify(value));
  const replacement = await claimImportCache(second, 'lease');
  assert.equal(replacement.kind, 'owned');
  if (old.kind !== 'owned' || replacement.kind !== 'owned') throw new Error('Missing lease');
  assert.equal(await old.beforeAttempt(), false);
  assert.equal(await old.cancel(), false);
  assert.equal(await old.finish({ stale: true }), false);
  assert.equal(await replacement.beforeAttempt(), true);
  assert.equal(await replacement.finish({ food: 'unknown' }), true);
  assert.deepEqual(await claimImportCache(first, 'lease'), { kind: 'cached', details: { food: 'unknown' } });
});

test('attempted imports retain cooldown after lease expiry, while capacity rejections release the claim', pgTest, async () => {
  const claim = await claimImportCache(first, 'cooldown');
  if (claim.kind !== 'owned') throw new Error('Missing lease');
  assert.equal(await claim.beforeAttempt(), true);
  const value = JSON.parse((await first.getMeta('cooldown'))!);
  value.until = Date.now() - IMPORT_LEASE_MS;
  await first.setMeta('cooldown', JSON.stringify(value));
  assert.equal((await claimImportCache(second, 'cooldown')).kind, 'busy');
  value.retryAt = Date.now() - 1;
  await first.setMeta('cooldown', JSON.stringify(value));
  assert.equal((await claimImportCache(second, 'cooldown')).kind, 'owned');
  const rejected = await claimImportCache(first, 'capacity');
  if (rejected.kind !== 'owned') throw new Error('Missing lease');
  assert.equal(await rejected.cancel(), true);
  assert.equal((await claimImportCache(second, 'capacity')).kind, 'owned');
});

test('database time ignores replica clock skew and cache writes require an unexpired lease', pgTest, async () => {
  const snapshot = await first.getMetaSnapshot('clock');
  const claim = await claimImportCache(second, 'clock', snapshot.now + 100000000);
  assert.equal(claim.kind, 'owned');
  const value = JSON.parse((await first.getMeta('clock'))!);
  assert.ok(value.until < snapshot.now + IMPORT_LEASE_MS + 1000);
  assert.equal(await first.compareMeta('clock', JSON.stringify(value), '{}', snapshot.now - 1), false);
});
