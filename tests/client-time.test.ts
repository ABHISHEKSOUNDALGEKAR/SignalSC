import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campusInput, campusInstant, campusRange } from '../client/src/time';

test('organizer dates round-trip in Los Angeles independently of browser timezone', () => {
  for (const [input, iso] of [
    ['2026-11-15T18:00', '2026-11-16T02:00:00.000Z'],
    ['2026-07-15T18:00', '2026-07-16T01:00:00.000Z'],
    ['2026-03-08T03:30', '2026-03-08T10:30:00.000Z'],
    ['2026-11-01T03:30', '2026-11-01T11:30:00.000Z'],
  ]) {
    assert.equal(campusInstant(input), iso);
    assert.equal(campusInput(iso), input);
  }
  assert.equal(campusInstant(''), null);
  assert.throws(() => campusInstant('2026-03-08T02:30'), /does not exist/);
});
test('today filters use 23-hour and 25-hour campus days across daylight saving changes', () => {
  const spring = new URLSearchParams(campusRange('today', new Date('2026-03-08T18:00:00Z')));
  assert.equal(spring.get('from'), '2026-03-08T08:00:00.000Z');
  assert.equal(spring.get('to'), '2026-03-09T07:00:00.000Z');
  const autumn = new URLSearchParams(campusRange('today', new Date('2026-11-01T18:00:00Z')));
  assert.equal(autumn.get('from'), '2026-11-01T07:00:00.000Z');
  assert.equal(autumn.get('to'), '2026-11-02T08:00:00.000Z');
});
