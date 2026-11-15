import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserValue } from '../client/src/storage';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function storage(entries: Record<string, string>, cannotWrite = false) {
  const values = new Map(Object.entries(entries));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (cannotWrite) throw new Error('Storage is read-only.');
        values.set(key, value);
      },
    },
  });
  return values;
}

test('SignalSC preserves saved events, device identity, and feedback submission history', () => {
  for (const suffix of ['saved', 'device', 'feedback-submitted'] as const) {
    const previous = suffix === 'device' ? 'existing-device-identity' : '["existing-event"]';
    const values = storage({ [`trojan-signal-${suffix}`]: previous });
    assert.equal(readBrowserValue(suffix), previous);
    assert.equal(values.get(`signalsc-${suffix}`), previous);
    assert.equal(values.get(`trojan-signal-${suffix}`), previous);
  }
});

test('SignalSC never overwrites newer browser data with legacy data', () => {
  storage({ 'signalsc-saved': '["new"]', 'trojan-signal-saved': '["old"]' });
  assert.equal(readBrowserValue('saved'), '["new"]');
});

test('legacy data remains readable if copying is blocked', () => {
  storage({ 'trojan-signal-saved': '["old"]' }, true);
  assert.equal(readBrowserValue('saved'), '["old"]');
});

test('a fresh browser starts without saved data', () => {
  storage({});
  assert.equal(readBrowserValue('saved'), null);
});
