/** Step 7 acceptance against the disposable fixture server, never a deployed service. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { DraftResponse, EventResponse, EventsResponse, SearchResponse } from '../../shared/api';
import { dateLabel, eventsPath, groupEvents } from '../src/lib/events';

const origin = 'http://127.0.0.1:3003';
const artifactDir = '/private/tmp/trojan-step7-calendar';
async function request(path: string, cookie = '', method = 'GET', json?: unknown) {
  return fetch(origin + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
}

test('Step 7 real API acceptance: ambiguous draft, isolation, corrections, calendar cases, edit/cancel', async t => {
  const health = await (await request('/api/health')).json();
  assert.equal(health.mode, 'memory'); assert.equal(health.modelConfigured, false);
  const login = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-a' });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const otherLogin = await request('/api/organizer/session', '', 'POST', { accessCode: 'demo-b' });
  assert.equal(otherLogin.status, 200); const otherCookie = otherLogin.headers.get('set-cookie')!.split(';')[0];
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4V0AAAAASUVORK5CYII=';
  const created = await request('/api/organizer/drafts', cookie, 'POST', { text: '[SYNTHETIC] Step Seven meetup Friday at 6. Date, year, location and cost require organizer review.', imageBase64: png, mimeType: 'image/png' });
  assert.equal(created.status, 201); const draft = (await created.json() as DraftResponse).draft;
  assert.equal(draft.extractedBy, 'manual'); assert.equal(draft.draft.costCents, null); assert.equal(draft.draft.food, 'unknown');
  assert.ok(draft.draft.uncertainties.length); assert.equal(draft.draft.startsAt, null);
  assert.equal((await request(draft.flyerUrl!)).headers.get('content-type'), 'image/png');
  for (const suffix of ['', '/calendar.ics']) assert.equal((await request(`/api/events/${draft.id}${suffix}`)).status, 404);
  const missing = await request(`/api/organizer/drafts/${draft.id}/publish`, cookie, 'POST');
  assert.equal(missing.status, 422); assert.deepEqual((await missing.json()).missing, ['title', 'startsAt', 'location']);
  assert.equal((await request(`/api/organizer/drafts/${draft.id}`, otherCookie, 'PATCH', { title: 'Unauthorized' })).status, 403);
  // A correctly signed cookie whose expiry is in the past, rather than merely an invalid signature.
  const payload = 'demo-org-a.1';
  const expired = `ts_organizer=${payload}.${createHmac('sha256', 'development-only-session-secret').update(payload).digest('base64url')}`;
  assert.equal((await request('/api/organizer/session', expired)).status, 401);
  assert.equal((await request(`/api/organizer/drafts/${draft.id}`, expired, 'PATCH', { title: 'Expired' })).status, 401);
  const title = '[SYNTHETIC] Step Seven, clocks; café \\ Club — ' + 'long title '.repeat(9).trimEnd();
  const location = 'Room 7, Building; USC \\ North\nSecond floor';
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const patch = { title, location, startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(), registrationUrl: 'https://example.com/step-seven-register', sourceUrl: 'https://example.com/step-seven-source' };
  assert.equal((await request(`/api/organizer/drafts/${draft.id}`, cookie, 'PATCH', patch)).status, 200);
  const published = await request(`/api/organizer/drafts/${draft.id}/publish`, cookie, 'POST');
  assert.equal(published.status, 200); const event = (await published.json() as EventResponse).event;
  assert.deepEqual(event.evidence, draft.draft.evidence); assert.equal(event.costCents, null); assert.equal(event.food, 'unknown');
  const broad = await (await request('/api/search', '', 'POST', { query: 'Step Seven' })).json() as SearchResponse;
  assert.ok(broad.results.some(result => result.event.id === draft.id));
  const strict = await (await request('/api/search', '', 'POST', { query: 'Step Seven free events with food' })).json() as SearchResponse;
  assert.equal(strict.noMatch, true); assert.deepEqual(strict.results, []);
  const freeFeed = await (await request('/api/events?free=1')).json() as EventsResponse;
  assert.ok(!freeFeed.events.some(record => record.id === draft.id));
  await mkdir(artifactDir, { recursive: true });
  const cases = [
    { name: 'winter', start: '2026-01-16T02:00:00Z', wall: '2026-01-15 18:00:00 -0800' },
    { name: 'summer', start: '2026-07-16T01:00:00Z', wall: '2026-07-15 18:00:00 -0700' },
    { name: 'before-midnight', start: '2026-11-15T07:30:00Z', wall: '2026-11-14 23:30:00 -0800' },
    { name: 'after-midnight', start: '2026-11-15T08:30:00Z', wall: '2026-11-15 00:30:00 -0800' },
    { name: 'fall-first', start: '2026-11-01T08:30:00Z', wall: '2026-11-01 01:30:00 -0700' },
    { name: 'fall-second', start: '2026-11-01T09:30:00Z', wall: '2026-11-01 01:30:00 -0800' },
  ];
  const expected = [];
  for (const item of cases) {
    const end = new Date(Date.parse(item.start) + 3600000).toISOString();
    assert.equal((await request(`/api/organizer/events/${draft.id}`, cookie, 'PATCH', { startsAt: item.start, endsAt: end })).status, 200);
    const detail = (await (await request(`/api/events/${draft.id}`)).json() as EventResponse).event;
    const calendar = await request(`/api/events/${draft.id}/calendar.ics`);
    assert.equal(calendar.status, 200); assert.match(calendar.headers.get('content-type')!, /text\/calendar/);
    assert.match(calendar.headers.get('content-disposition')!, /attachment; filename=.*\.ics/);
    await writeFile(`${artifactDir}/${item.name}.ics`, await calendar.text());
    expected.push({ ...item, end, title, location, label: dateLabel(detail.startsAt) });
    if (item.name === 'before-midnight' || item.name === 'after-midnight') {
      const window = (await (await request('/api/events?from=2026-11-14T08:00:00Z&to=2026-11-15T08:00:00Z')).json() as EventsResponse).events;
      assert.equal(window.some(record => record.id === draft.id), item.name === 'before-midnight');
    }
    if (item.name.startsWith('fall-')) {
      const window = (await (await request('/api/events?from=2026-11-01T08:00:00Z&to=2026-11-01T09:00:00Z')).json() as EventsResponse).events;
      assert.equal(window.some(record => record.id === draft.id), item.name === 'fall-first');
    }
    assert.match(dateLabel(detail.startsAt), item.wall.endsWith('-0800') ? /PST/ : /PDT/);
  }
  await writeFile(`${artifactDir}/expected.json`, JSON.stringify(expected, null, 2));
  const midnight = await (await request('/api/events?from=2026-11-14T08:00:00Z&to=2026-11-15T08:00:00Z')).json() as EventsResponse;
  assert.ok(!midnight.events.some(record => record.id === draft.id)); // Event is now at the Nov 1 fold.
  const grouped = groupEvents(cases.slice(2, 4).map(item => ({ ...event, startsAt: item.start })));
  assert.deepEqual(grouped.map(([day]) => day), ['2026-11-14', '2026-11-15']);
  for (const [at, upper] of [['2026-03-08T08:00:00Z', '2026-03-09T07:00:00.000Z'], ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00.000Z']]) {
    const path = eventsPath({ date: 'today', free: false, food: false }, new Date(at));
    assert.equal(new URL(origin + path).searchParams.get('to'), upper);
    assert.equal((await request(path)).status, 200);
  }
  assert.equal((await request(`/api/organizer/events/${draft.id}`, cookie, 'PATCH', { startsAt, endsAt: patch.endsAt, title: '[SYNTHETIC] Step Seven updated' })).status, 200);
  assert.equal((await request(`/api/organizer/events/${draft.id}`, otherCookie, 'PATCH', { cancelled: true })).status, 403);
  assert.equal((await request(`/api/organizer/events/${draft.id}`, cookie, 'PATCH', { cancelled: true })).status, 200);
  for (const records of [
    (await (await request('/api/events')).json() as EventsResponse).events,
    (await (await request('/api/search', '', 'POST', { query: 'Step Seven' })).json() as SearchResponse).results.map(result => result.event),
  ]) assert.ok(!records.some(record => record.id === draft.id));
  assert.equal((await request(`/api/events/${draft.id}`)).status, 200, 'Existing backend deliberately exposes cancellation to saved readers.');
  const cancelledCalendar = await request(`/api/events/${draft.id}/calendar.ics`);
  assert.equal(cancelledCalendar.status, 200); assert.match(await cancelledCalendar.text(), /STATUS:CANCELLED/);
  assert.equal((await request('/api/flyers/missing-step-seven')).status, 404);
  for (const [id, kind] of [['synthetic-import', 'usc-calendar'], ['synthetic-engagesc', 'engagesc']]) {
    const imported = (await (await request(`/api/events/${id}`)).json() as EventResponse).event;
    assert.equal(imported.sourceKind, kind); assert.equal(imported.confirmation, 'source-imported');
  }
  const unknownEnd = (await (await request('/api/events/synthetic-paid')).json() as EventResponse).event;
  assert.equal(unknownEnd.endsAt, null);
  const placeholder = await (await request('/api/events/synthetic-paid/calendar.ics')).text();
  const placeholderEnd = new Date(Date.parse(unknownEnd.startsAt!) + 3600000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  assert.ok(placeholder.includes(`DTEND:${placeholderEnd}`), 'Unknown-end export uses the one-hour placeholder disclosed by the frontend.');
  t.diagnostic(`Independent-parser fixtures: ${artifactDir}. Lifecycle record: ${draft.id}. All data synthetic.`);
});
