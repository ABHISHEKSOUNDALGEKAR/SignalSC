import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  answerRegistration, markRegistrationDeparture, moveRegistrationToSaved,
  nextRegistrationCheck, readRegistrations, REGISTRATION_KEY, startRegistrationCheck,
} from '../client/src/registration-store';
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function storage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } });
  return data;
}
const fixture = { id: 'event-a', title: 'Community Dinner' };
const now = 1_000_000;

test('outbound click alone does not ask or claim registration; returning makes it eligible', () => {
  storage();
  startRegistrationCheck(fixture, 'source-tab', now);
  assert.equal(nextRegistrationCheck(now), null);
  assert.deepEqual(readRegistrations().registered, []);
  markRegistrationDeparture('another-tab');
  assert.equal(nextRegistrationCheck(now), null);
  markRegistrationDeparture('source-tab');
  assert.equal(nextRegistrationCheck(now)?.id, fixture.id);
});
test('confirmation persists, deduplicates IDs, and stops future outbound reminders', () => {
  storage();
  startRegistrationCheck(fixture, 'source-tab', now);
  markRegistrationDeparture('source-tab');
  answerRegistration(fixture.id, 'yes', now);
  answerRegistration(fixture.id, 'yes', now);
  startRegistrationCheck(fixture, 'source-tab', now);
  assert.deepEqual(readRegistrations().registered, [fixture.id]);
  assert.deepEqual(readRegistrations().pending, []);
});
test('not yet never registers and does not nag again without another outbound click', () => {
  storage();
  startRegistrationCheck(fixture, 'a', now);
  markRegistrationDeparture('a');
  answerRegistration(fixture.id, 'no', now);
  assert.equal(nextRegistrationCheck(now), null);
  assert.deepEqual(readRegistrations().registered, []);
  startRegistrationCheck(fixture, 'a', now + 1);
  markRegistrationDeparture('a');
  assert.equal(nextRegistrationCheck(now + 1)?.id, fixture.id);
});
test('not now defers for one hour and expired pending entries are ignored', () => {
  storage();
  startRegistrationCheck(fixture, 'a', now);
  markRegistrationDeparture('a');
  answerRegistration(fixture.id, 'later', now);
  assert.equal(nextRegistrationCheck(now + 10), null);
  assert.equal(nextRegistrationCheck(now + 3_600_001)?.id, fixture.id);
  assert.equal(nextRegistrationCheck(now + 8 * 86_400_000), null);
});
test('multiple visits are queued by event, not overwritten by another event', () => {
  storage();
  startRegistrationCheck(fixture, 'a', now);
  startRegistrationCheck({ id: 'event-b', title: 'Robotics' }, 'a', now + 1);
  startRegistrationCheck(fixture, 'a', now + 2);
  markRegistrationDeparture('a');
  assert.equal(readRegistrations().pending.length, 2);
  answerRegistration('event-b', 'yes', now);
  assert.equal(nextRegistrationCheck(now + 3)?.id, fixture.id);
});
test('moving a registration to Saved preserves older saved items and clears reminders', () => {
  const data = storage({ 'trojan-signal-saved': '["old-event"]' });
  answerRegistration(fixture.id, 'yes', now);
  moveRegistrationToSaved(fixture.id);
  assert.deepEqual(readRegistrations().registered, []);
  assert.deepEqual(JSON.parse(data.get('signalsc-saved')!), ['old-event', fixture.id]);
  assert.equal(data.get('trojan-signal-saved'), '["old-event"]');
});
test('corrupt registration storage is not silently replaced', () => {
  const data = storage({ [REGISTRATION_KEY]: '{"broken":true}' });
  assert.throws(() => startRegistrationCheck(fixture, 'a', now));
  assert.equal(data.get(REGISTRATION_KEY), '{"broken":true}');
});
test('a failed Saved write never removes an existing registration', () => {
  storage();
  answerRegistration(fixture.id, 'yes', now);
  Object.defineProperty(globalThis.localStorage, 'setItem', { value: () => { throw new Error('Quota exceeded'); } });
  assert.throws(() => moveRegistrationToSaved(fixture.id));
  assert.deepEqual(readRegistrations().registered, [fixture.id]);
});
