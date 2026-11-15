import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, type CoordinationStore } from '../server/store';
import { MODEL_SLOT_MS, SharedModelBudget } from '../server/shared-model-budget';
import { getModelOperationCounters } from '../server/model-operations';

test('shared admission diagnostics distinguish budget, concurrency, and replica mismatches', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args.join(' ')); });
  const before = getModelOperationCounters();

  const concurrencyGate = new SharedModelBudget(new MemoryStore(), 5, 100_000, 1);
  const held = await concurrencyGate.acquire();
  await assert.rejects(concurrencyGate.acquire(), /concurrency/);
  await held.release();

  const budgetStore = new MemoryStore();
  const budgetGate = new SharedModelBudget(budgetStore, 1, 100_000, 1);
  await (await budgetGate.acquire()).release();
  await assert.rejects(budgetGate.acquire(), /budget/);

  const mismatchStore = new MemoryStore();
  await new SharedModelBudget(mismatchStore, 5, 100_000, 1).acquire();
  await assert.rejects(new SharedModelBudget(mismatchStore, 6, 100_000, 1).acquire(), /settings differ/);

  const after = getModelOperationCounters();
  assert.equal(after.admission_concurrency_limit_reached - before.admission_concurrency_limit_reached, 1);
  assert.equal(after.admission_request_budget_exhausted - before.admission_request_budget_exhausted, 1);
  assert.equal(after.admission_replica_settings_mismatch - before.admission_replica_settings_mismatch, 1);
  assert.ok(logs.some(line => line.includes('admission_concurrency_limit_reached')));
  assert.ok(logs.some(line => line.includes('admission_request_budget_exhausted')));
  assert.ok(logs.some(line => line.includes('admission_replica_settings_mismatch')));
  assert.doesNotMatch(logs.join(' '), /model-admission|100000|settings differ/);
});

test('expired slots and coordination outages have separate sanitized diagnostics', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args.join(' ')); });
  const before = getModelOperationCounters();
  let now = 0;
  const store = new MemoryStore(() => now);
  const gate = new SharedModelBudget(store, 3, MODEL_SLOT_MS * 2, 1);
  await gate.acquire();
  now += MODEL_SLOT_MS;
  await (await gate.acquire()).release();

  const unavailableStore: CoordinationStore = {
    async getMetaSnapshot() { throw new Error('private connection details'); },
    async compareMeta() { throw new Error('private connection details'); },
  };
  await assert.rejects(new SharedModelBudget(unavailableStore, 3, 10_000, 1).acquire());

  const after = getModelOperationCounters();
  assert.equal(after.admission_slot_expired - before.admission_slot_expired, 1);
  assert.equal(after.admission_coordination_unavailable - before.admission_coordination_unavailable, 1);
  assert.ok(logs.some(line => line.includes('admission_slot_expired')));
  assert.ok(logs.some(line => line.includes('admission_coordination_unavailable')));
  assert.doesNotMatch(logs.join(' '), /private connection details/);
});
