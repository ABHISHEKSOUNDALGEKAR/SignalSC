import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { EventRecord } from '../../shared/api';
import { emptyDraft, toDraft } from '../extract';
import { buildIcs, parseIcs } from '../ics';
import { mapFeedEvent } from '../importer';
import { applyPatch, missingForPublish } from '../records';
import { interpretWithRules, search } from '../search';
import { campusTimeToDate, toCampusIso } from '../time';

const NOW = new Date('2026-11-14T15:00:00-08:00'); // Saturday, 3:00 PM on campus

function event(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: crypto.randomUUID(), title: 'Campus Mixer', description: '', startsAt: '2026-11-14T19:00:00-08:00',
    endsAt: '2026-11-14T21:00:00-08:00', timezone: 'America/Los_Angeles', location: 'Ginsburg Hall 101', eligibility: null,
    costCents: null, food: 'unknown', beginnerFriendly: null, registrationUrl: null, registrationDeadline: null,
    sourceUrl: null, sourceKind: 'flyer', evidence: [], uncertainties: [], status: 'published',
    confirmation: 'organizer-confirmed', organizationName: 'Test Org A', flyerUrl: null,
    updatedAt: NOW.toISOString(), publishedAt: NOW.toISOString(), ...over,
  };
}
const titles = (r: { results: { event: EventRecord }[] }) => r.results.map(x => x.event.title);
const reasons = (r: { excluded: { reason: string; count: number }[] }) => Object.fromEntries(r.excluded.map(x => [x.reason, x.count]));

// ---------- Search rules ----------

test('unknown cost never matches a free-only request', async () => {
  const r = await search('free events tonight', [
    event({ title: 'Cost unknown', costCents: null }),
    event({ title: 'Stated free', costCents: 0 }),
    event({ title: 'Five dollars', costCents: 500 }),
  ], NOW);
  assert.deepEqual(titles(r), ['Stated free']);
  assert.deepEqual(reasons(r), { 'cost is not stated': 1, 'has a cost': 1 });
});

test('asking for free food filters on food, not on admission cost', async () => {
  const r = await search('free food tonight', [
    event({ title: 'Food unknown', food: 'unknown' }),
    event({ title: 'No food mentioned', food: 'not-advertised' }),
    event({ title: 'Pizza night', food: 'advertised', costCents: null }),
  ], NOW);
  assert.equal(r.constraints.foodAdvertisedOnly, true);
  assert.equal(r.constraints.freeOnly, false);
  assert.deepEqual(titles(r), ['Pizza night']);
  assert.deepEqual(reasons(r), { 'food information is unknown': 1, 'no food advertised': 1 });
});

test('unknown suitability never matches a beginner-only request', async () => {
  const r = await search('beginner friendly events tonight', [
    event({ title: 'Not stated', beginnerFriendly: null }),
    event({ title: 'Experience required', beginnerFriendly: false }),
    event({ title: 'Beginners welcome', beginnerFriendly: true }),
  ], NOW);
  assert.deepEqual(titles(r), ['Beginners welcome']);
  assert.deepEqual(reasons(r), { 'not stated as beginner-friendly': 2 });
});

test('"tonight after 6" uses explicit campus-time boundaries', async () => {
  const r = await search('what can I go to tonight after 6', [
    event({ title: 'Too early', startsAt: '2026-11-14T17:30:00-08:00', endsAt: '2026-11-14T18:30:00-08:00' }),
    event({ title: 'Tonight at seven', startsAt: '2026-11-14T19:00:00-08:00' }),
    event({ title: 'Tomorrow night', startsAt: '2026-11-15T19:00:00-08:00', endsAt: '2026-11-15T21:00:00-08:00' }),
  ], NOW);
  assert.equal(r.constraints.afterMinutes, 18 * 60);
  assert.equal(r.constraints.to, '2026-11-15T00:00:00-08:00');
  assert.deepEqual(titles(r), ['Tonight at seven']);
  assert.deepEqual(reasons(r), { 'starts before 6:00 PM': 1 });
});

test('cancelled, finished and months-long listings are not returned', async () => {
  const r = await search('events this week', [
    event({ title: 'Cancelled', status: 'cancelled' }),
    event({ title: 'Ended this morning', startsAt: '2026-11-14T09:00:00-08:00', endsAt: '2026-11-14T10:00:00-08:00' }),
    event({ title: 'Semester-long check-in', startsAt: '2026-08-24T13:00:00-07:00', endsAt: '2026-12-01T13:00:00-08:00' }),
    event({ title: 'Started an hour ago', startsAt: '2026-11-14T14:00:00-08:00', endsAt: '2026-11-14T16:00:00-08:00' }),
    event({ title: 'No start time', startsAt: null, endsAt: null }),
  ], NOW);
  assert.deepEqual(titles(r), ['Started an hour ago']);
});

test('a search with no exact match keeps exact results empty and labels related suggestions', async () => {
  const r = await search('robotics tonight', [event({ title: 'Poetry reading' })], NOW);
  assert.equal(r.noMatch, true);
  assert.deepEqual(r.results, []);
  assert.match(r.answer, /No exact matches/);
  assert.ok(r.relatedResults?.length);
  assert.ok(r.relatedResults?.every(item => item.differences?.length));
});

test('topic keywords match title, description and organization', async () => {
  const r = await search('sustainability', [
    event({ title: 'Beach clean up', organizationName: 'Sustainability Hub' }),
    event({ title: 'Sustainability stroll' }),
    event({ title: 'Chess night', description: 'Open play' }),
  ], NOW);
  assert.deepEqual(titles(r), ['Sustainability stroll', 'Beach clean up']); // title matches rank first
});

test('a repeating event is shown once, at its next occurrence', async () => {
  const weekly = (day: string) => event({ title: 'Weekly General Meeting', startsAt: `2026-11-${day}T19:30:00-08:00`, endsAt: `2026-11-${day}T20:30:00-08:00` });
  const r = await search('meeting', [weekly('20'), weekly('16'), weekly('18')], NOW);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].event.startsAt, '2026-11-16T19:30:00-08:00');
});

test('rule interpreter reads relative days and times', () => {
  const tomorrow = interpretWithRules('anything tomorrow after 5:30pm?', NOW);
  assert.equal(tomorrow.from, '2026-11-15T00:00:00-08:00');
  assert.equal(tomorrow.to, '2026-11-16T00:00:00-08:00');
  assert.equal(tomorrow.afterMinutes, 17 * 60 + 30);
  assert.equal(interpretWithRules('after 5', NOW).afterMinutes, 17 * 60); // "after 5" means 5 PM
});

// ---------- Time ----------

test('campus times follow daylight saving', () => {
  assert.equal(toCampusIso(campusTimeToDate(2026, 7, 4, 9, 0)), '2026-07-04T09:00:00-07:00');
  assert.equal(toCampusIso(campusTimeToDate(2026, 11, 1, 12, 0)), '2026-11-01T12:00:00-08:00'); // clocks went back at 2 AM
  assert.equal(toCampusIso(campusTimeToDate(2026, 3, 8, 12, 0)), '2026-03-08T12:00:00-07:00'); // clocks went forward at 2 AM
  assert.equal(campusTimeToDate(2026, 12, 3, 18, 0).toISOString(), '2026-12-04T02:00:00.000Z');
});

// ---------- Flyer extraction post-processing ----------

const extraction = {
  title: 'Build Night', description: 'Bring a laptop.', date: '2026-11-20' as string | null, yearStated: true,
  startTime: '19:00' as string | null, endTime: null as string | null, location: 'RTH 105' as string | null, eligibility: null,
  isFree: null as boolean | null, costDollars: null as number | null, food: 'unknown' as const, beginnerFriendly: null,
  registrationUrl: null as string | null, registrationDeadlineDate: null, registrationDeadlineTime: null, evidence: [], uncertainties: [],
};

test('a flyer without a year is dated to its next occurrence and flagged', () => {
  const soon = toDraft({ ...extraction, yearStated: false }, NOW, null);
  assert.equal(soon.startsAt, '2026-11-20T19:00:00-08:00');
  assert.ok(soon.uncertainties.some(u => /Year not printed/.test(u)));
  const nextYear = toDraft({ ...extraction, date: '2026-01-10', yearStated: false }, NOW, null);
  assert.equal(nextYear.startsAt, '2027-01-10T19:00:00-08:00');
});

test('missing details stay unknown and are flagged, never invented', () => {
  const d = toDraft({ ...extraction, date: null, startTime: null, location: null }, NOW, null);
  assert.equal(d.startsAt, null);
  assert.equal(d.location, null);
  assert.equal(d.costCents, null);
  assert.ok(d.uncertainties.includes('No event date found.'));
  assert.ok(d.uncertainties.includes('No location found.'));
  assert.deepEqual(missingForPublish(d), ['startsAt', 'location']);
});

test('cost is only set when the flyer states it', () => {
  assert.equal(toDraft({ ...extraction }, NOW, null).costCents, null);
  assert.equal(toDraft({ ...extraction, isFree: true }, NOW, null).costCents, 0);
  assert.equal(toDraft({ ...extraction, isFree: false, costDollars: 5 }, NOW, null).costCents, 500);
});

test('incomplete or unsafe registration links are dropped and flagged', () => {
  const short = toDraft({ ...extraction, registrationUrl: 'bit.ly/buildnight' }, NOW, null);
  assert.equal(short.registrationUrl, null);
  assert.ok(short.uncertainties.some(u => /incomplete/.test(u)));
  assert.equal(toDraft({ ...extraction, registrationUrl: 'javascript:alert(1)' }, NOW, null).registrationUrl, null);
  assert.equal(toDraft({ ...extraction, registrationUrl: 'https://example.com/rsvp' }, NOW, null).registrationUrl, 'https://example.com/rsvp');
});

test('an end time before the start time means the event runs past midnight', () => {
  const d = toDraft({ ...extraction, startTime: '22:00', endTime: '01:00' }, NOW, null);
  assert.equal(d.endsAt, '2026-11-21T01:00:00-08:00');
});

// ---------- Publishing and edits ----------

test('publishing needs a title, start time and location', () => {
  assert.deepEqual(missingForPublish(emptyDraft(null)), ['title', 'startsAt', 'location']);
});

test('edits cannot change provenance or produce an invalid time range', () => {
  const draft = { ...emptyDraft(null), title: 'Build Night', startsAt: '2026-11-20T19:00:00-08:00', location: 'RTH 105' };
  assert.equal(applyPatch(draft, { sourceKind: 'engagesc' }).ok, false);
  assert.equal(applyPatch(draft, { evidence: [] }).ok, false);
  assert.equal(applyPatch(draft, { endsAt: '2026-11-20T18:00:00-08:00' }).ok, false);
  assert.equal(applyPatch(draft, { registrationUrl: 'javascript:alert(1)' }).ok, false);
  const cleared = applyPatch(draft, { location: null, costCents: 0 });
  assert.ok(cleared.ok && cleared.draft.location === null && cleared.draft.costCents === 0);
});

// ---------- Calendar export and feed import ----------

test('calendar export round-trips text and time', () => {
  const ics = buildIcs({
    id: 'abc', title: 'Pizza, Code; Chill', description: 'Line one\nLine two, with a comma. ' + 'x'.repeat(120),
    startsAt: '2026-03-08T18:00:00-07:00', endsAt: null, location: 'SAL 101', url: 'https://example.com/e', cancelled: false,
    updatedAt: NOW.toISOString(),
  }, 'example.test');
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const [parsed] = parseIcs(ics, campusTimeToDate);
  assert.equal(parsed.summary, 'Pizza, Code; Chill');
  assert.ok(parsed.description.startsWith('Line one\nLine two, with a comma.'));
  assert.equal(parsed.start?.toISOString(), '2026-03-09T01:00:00.000Z');
  assert.equal(parsed.end?.toISOString(), '2026-03-09T02:00:00.000Z'); // one hour when no end is given
  assert.equal(parsed.status, 'CONFIRMED');
});

const FEED = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
  'ORGANIZER;CN="USC Mann: Student Council ":mailto:noreply@example.edu',
  'CATEGORIES;X-CG-CATEGORY=event_type:Social Event / Reception',
  'CATEGORIES;X-CG-CATEGORY=event_tags:Sustainability,Community',
  'DTSTART:20261120T020000Z', 'DTEND:20261120T040000Z', 'UID:feed-1@example',
  'SUMMARY;ENCODING=QUOTED-PRINTABLE:Thanksgiving Social',
  'LOCATION: Sign in to download the location',
  'URL:https://engage.usc.edu/rsvp?id=1',
  'DESCRIPTION:Join us for a potluck with great company!\\n---\\nEvent Details: https://engage.usc.edu/rsvp?id=1',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

test('feed records keep provenance and never guess hidden details', () => {
  const [parsed] = parseIcs(FEED, campusTimeToDate);
  assert.equal(parsed.organizer, 'USC Mann: Student Council');
  const mapped = mapFeedEvent(parsed, 'engagesc', NOW);
  assert.ok(mapped);
  const d = mapped.draft;
  assert.equal(d.startsAt, '2026-11-19T18:00:00-08:00');
  assert.equal(d.location, null);
  assert.deepEqual(d.uncertainties, ['Location is shown on EngageSC after USC sign-in.']);
  assert.equal(d.sourceUrl, 'https://engage.usc.edu/rsvp?id=1');
  assert.equal(d.description, 'Join us for a potluck with great company!\n\nEvent type: Social Event / Reception. Tags: Sustainability, Community.');
  assert.equal(d.food, 'advertised');
  assert.match(d.evidence[0].excerpt, /potluck/);
  assert.equal(d.costCents, null); // nothing in the listing states a price
  assert.equal(mapped.externalId, 'engagesc:feed-1@example');
});

test('feed records without an explicit food offer stay unknown, and past events are skipped', () => {
  const [parsed] = parseIcs(FEED.replace('a potluck with great company', 'a lunch break discussion'), campusTimeToDate);
  assert.equal(mapFeedEvent(parsed, 'engagesc', NOW)?.draft.food, 'unknown');
  assert.equal(mapFeedEvent(parsed, 'engagesc', new Date('2026-12-01T00:00:00Z')), null);
});
