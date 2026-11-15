import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWithSaves as renderToStaticMarkup } from './render-with-saves';
import { campusDayStart, eventsPath, initialFilters, groupEvents, dateLabel, costLabel, foodLabel, confirmationLabel, webUrl } from '../src/lib/events';
import { getEvent } from '../src/lib/api';
import { EventInformation } from '../src/screens/EventDetail';
import { EventCard } from '../src/components/EventCard';
import { eventFixture } from './event-fixtures';
import { inWindow } from '../../server/search';

const now = new Date('2026-11-14T20:00:00Z');
test('filters combine, reset, and send only active flags and ISO date bounds', () => {
  for (const free of [false, true]) for (const food of [false, true]) for (const date of ['all', 'today', 'week'] as const) {
    const url = new URL(eventsPath({ free, food, date }, now), 'http://localhost');
    assert.equal(url.searchParams.get('free'), free ? '1' : null);
    assert.equal(url.searchParams.get('food'), food ? '1' : null);
    assert.equal(url.searchParams.get('from'), now.toISOString());
    assert.equal(url.searchParams.get('to'), date === 'all' ? null : date === 'today' ? '2026-11-15T08:00:00.000Z' : '2026-11-16T08:00:00.000Z');
  }
  assert.equal(new URL(eventsPath(initialFilters, now), 'http://localhost').searchParams.size, 1);
});

test('This week ends next Monday from both Monday and Sunday; year rollover works', () => {
  for (const value of ['2026-11-16T20:00:00Z', '2026-11-22T20:00:00Z']) {
    assert.equal(new URL(eventsPath({ ...initialFilters, date: 'week' }, new Date(value)), 'http://localhost').searchParams.get('to'), '2026-11-23T08:00:00.000Z');
  }
  assert.equal(campusDayStart(new Date('2026-12-31T20:00:00Z'), 1).toISOString(), '2027-01-01T08:00:00.000Z');
});

test('Los Angeles midnight and date groups ignore the execution timezone and sort without mutation', () => {
  const events = [eventFixture({ id: 'late', startsAt: '2026-11-15T08:30:00Z' }), eventFixture({ id: 'early', startsAt: '2026-11-15T07:30:00Z' })];
  const grouped = groupEvents(events);
  assert.match(grouped[0][1].label, /Nov 14/);
  assert.match(grouped[1][1].label, /Nov 15/);
  assert.equal(grouped[0][1].events[0].id, 'early');
  assert.equal(events[0].id, 'late');
  assert.match(dateLabel(events[1].startsAt), /11:30 PM PST/);
  assert.equal(dateLabel(null), 'Unknown');
  assert.equal(dateLabel('invalid'), 'Unknown');
});

test('calendar day boundaries respect winter/summer and 23/25 hour DST days', () => {
  for (const [day, start, hours] of [
    ['2026-03-08T12:00:00Z', '2026-03-08T08:00:00.000Z', 23],
    ['2026-11-01T12:00:00Z', '2026-11-01T07:00:00.000Z', 25],
    ['2026-01-15T20:00:00Z', '2026-01-15T08:00:00.000Z', 24],
    ['2026-07-15T20:00:00Z', '2026-07-15T07:00:00.000Z', 24],
  ] as const) {
    const date = new Date(day);
    assert.equal(campusDayStart(date).toISOString(), start);
    assert.equal((+campusDayStart(date, 1) - +campusDayStart(date)) / 3_600_000, hours);
  }
});

test('actual server window convention includes lower bound/ongoing and excludes upper bound/finished', () => {
  const params = new URL(eventsPath({ ...initialFilters, date: 'today' }, now), 'http://localhost').searchParams;
  const from = new Date(params.get('from')!); const to = new Date(params.get('to')!);
  const at = (value: number, endsAt: string | null = null) => eventFixture({ startsAt: new Date(value).toISOString(), endsAt });
  assert.equal(inWindow(at(+from), from, to), true);
  assert.equal(inWindow(at(+to - 1), from, to), true);
  assert.equal(inWindow(at(+to), from, to), false);
  assert.equal(inWindow(at(+from - 3600000, new Date(+from + 1).toISOString()), from, to), true);
  assert.equal(inWindow(at(+from - 3600000, from.toISOString()), from, to), false);
});

test('unknown, free, paid, food and all provenance labels remain distinct', () => {
  assert.equal(costLabel(null), 'Unknown'); assert.equal(costLabel(0), 'Free'); assert.equal(costLabel(1250), '$12.50');
  assert.deepEqual(['advertised', 'not-advertised', 'unknown'].map(value => foodLabel(value as 'advertised')), ['Advertised', 'Not advertised', 'Unknown']);
  assert.equal(confirmationLabel(eventFixture()), 'Organizer-confirmed');
  assert.equal(confirmationLabel(eventFixture({ confirmation: 'source-imported', sourceKind: 'engagesc' })), 'Imported from EngageSC');
  assert.equal(confirmationLabel(eventFixture({ confirmation: 'source-imported', sourceKind: 'usc-calendar' })), 'Imported from USC calendar');
  assert.equal(confirmationLabel(eventFixture({ confirmation: 'source-imported', sourceKind: 'flyer' })), 'Imported from Flyer');
});

test('detail/card markup includes correct actions, facts, evidence and safe unknown values', () => {
  const event = eventFixture({ id: 'encoded/id', beginnerFriendly: false, endsAt: null, location: null, flyerUrl: '/api/flyers/test' });
  const html = renderToStaticMarkup(<EventInformation event={event} />);
  for (const label of ['Starts', 'Ends', 'Timezone', 'Location', 'Organization', 'Eligibility', 'Admission', 'Food', 'Beginner-friendly', 'Registration deadline', 'Published', 'Last updated', 'Source evidence', 'Uncertainties']) assert.ok(html.includes(label), label);
  assert.match(html, /<dd>No<\/dd>/); assert.match(html, /<dd>Unknown<\/dd>/);
  assert.match(html, /href="\/api\/events\/encoded%2Fid\/calendar.ics"/);
  assert.match(html, /href="https:\/\/example.com\/register"/);
  assert.match(html, /href="https:\/\/example.com\/source"/);
  assert.match(html, /src="\/api\/flyers\/test"/);
  assert.match(html, /Synthetic flyer: snacks advertised/);
  assert.match(html, /dietary suitability is unknown/);
  assert.match(renderToStaticMarkup(<EventCard event={event} />), /href="#event\/encoded%2Fid"/);
});

test('missing links/flyer and malicious text are safe; cancelled detail is explicit', () => {
  const html = renderToStaticMarkup(<EventInformation event={eventFixture({ title: '<script>bad()</script>', description: '<b>plain text</b>', registrationUrl: null, sourceUrl: null, status: 'cancelled', food: 'unknown', beginnerFriendly: null, costCents: null })} />);
  assert.match(html, /Cancelled/); assert.match(html, /Flyer: Unknown/); assert.match(html, /Source link: Unknown/);
  assert.ok(!html.includes('>Register'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<b>'));
  assert.equal(webUrl('javascript:alert(1)'), undefined);
  assert.equal(webUrl('https://example.com'), 'https://example.com');
});

test('detail API encodes the selected ID and rejects mismatched records', async t => {
  const event = eventFixture({ id: 'selected/id' });
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, '/api/events/selected%2Fid'); return Response.json({ event });
  });
  assert.equal((await getEvent(event.id, new AbortController().signal)).event.id, event.id);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ event: eventFixture({ id: 'wrong' }) }));
  await assert.rejects(getEvent(event.id, new AbortController().signal), /could not be read/);
});

test('unknown end stays unknown while the calendar placeholder duration is disclosed', () => {
  const unknown = renderToStaticMarkup(<EventInformation event={eventFixture({ endsAt: null })} />);
  assert.match(unknown, /Ends<\/dt><dd>Unknown<\/dd>/);
  assert.match(unknown, /aria-describedby="calendar-duration-note"/);
  assert.match(unknown, /calendar file reserves one hour/);
  const known = renderToStaticMarkup(<EventInformation event={eventFixture()} />);
  assert.ok(!known.includes('calendar-duration-note'));
});
