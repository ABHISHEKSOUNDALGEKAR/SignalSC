// Explicit local integration run; requires serve-step2-fixtures.ts and Vite on 5174.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventsResponse, EventResponse } from '../../shared/api';
import { eventsPath, initialFilters } from '../src/lib/events';
import { inWindow } from '../../server/search';

const origin = 'http://127.0.0.1:5174';
test('real API through Vite: all filter combinations, order, public lifecycle and detail data', async () => {
  const now = new Date();
  for (const date of ['all', 'today', 'week'] as const) for (const free of [false, true]) for (const food of [false, true]) {
    const path = eventsPath({ date, free, food }, now);
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    const { events } = await response.json() as EventsResponse;
    const params = new URL(origin + path).searchParams;
    for (const event of events) {
      assert.equal(event.status, 'published');
      assert.ok(event.title.startsWith('[SYNTHETIC]'));
      assert.ok(inWindow(event, now, new Date(params.get('to') ?? +now + 60 * 86400000)));
      if (free) assert.equal(event.costCents, 0);
      if (food) assert.equal(event.food, 'advertised');
      assert.ok(!['synthetic-cancelled', 'synthetic-past'].includes(event.id));
    }
    const times = events.map(e => Date.parse(e.startsAt!));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
  const response = await fetch(origin + eventsPath(initialFilters, now));
  const { events } = await response.json() as EventsResponse;
  assert.ok(events.some(event => event.id === 'synthetic-import'));
  for (const id of ['synthetic-unknown', 'synthetic-import', 'synthetic-engagesc', 'synthetic-cancelled']) {
    const detail = await fetch(`${origin}/api/events/${id}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as EventResponse).event.id, id);
  }
  assert.equal((await fetch(`${origin}/api/events/does-not-exist`)).status, 404);
  const noMatch = await fetch(`${origin}/api/events?q=nonexistent-synthetic-keyword`);
  assert.deepEqual((await noMatch.json() as EventsResponse).events, []);
});

test('real flyer and calendar routes serve image/download with correct event time', async () => {
  assert.equal((await fetch(`${origin}/api/flyers/synthetic-image`)).headers.get('Content-Type'), 'image/png');
  assert.equal((await fetch(`${origin}/api/flyers/missing-image`)).status, 404);
  const event = (await (await fetch(`${origin}/api/events/synthetic-free`)).json() as EventResponse).event;
  const response = await fetch(`${origin}/api/events/synthetic-free/calendar.ics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type')!, /text\/calendar/);
  assert.match(response.headers.get('Content-Disposition')!, /attachment.*\.ics/);
  const ics = await response.text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:\[SYNTHETIC\] Campus meetup/);
  const expected = new Date(event.startsAt!).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  assert.ok(ics.includes(`DTSTART:${expected}`));
});
