import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { imagePayload, moneyToCents, readImage, reviewValues, serializeReview, timeChoices, toWall, validateCreate, validateFile, wallCandidates, wallToIso } from '../src/lib/organizer-form';
import { TaskGate } from '../src/lib/task';
import { requireSessionForOrganization, saveDraft } from '../src/lib/organizer-api';
import { ApiError } from '../src/lib/api';
import { ReviewForm } from '../src/components/ReviewForm';
import { eventFixture } from './event-fixtures';

test('money: blank, zero and fractional values preserve unknown/free/paid semantics', () => {
  for (const [value, expected] of [['', null], [' ', null], ['0', 0], ['12.50', 1250], ['0.29', 29], ['001.2', 120]] as const) assert.equal(moneyToCents(value), expected);
  for (const value of ['-1', '12.345', 'NaN', '1e3', '0x12', '10000000000000000000']) assert.throws(() => moneyToCents(value));
});

test('Los Angeles form times round-trip winter/summer irrespective of process timezone', () => {
  for (const [value, expected] of [['2026-01-15T18:00', '2026-01-16T02:00:00.000Z'], ['2026-07-15T18:00', '2026-07-16T01:00:00.000Z']]) {
    assert.equal(wallToIso(value, '', 'startsAt'), expected);
    assert.equal(toWall(expected), `${value}:00`);
  }
  assert.equal(wallToIso('', '', 'startsAt'), null);
});

test('DST gaps, invalid dates and repeated times require explicit correction or occurrence', () => {
  for (const value of ['2026-03-08T02:30', '2026-02-30T10:00', 'not a date']) assert.throws(() => wallToIso(value, '', 'startsAt'), /invalid|gap/);
  assert.deepEqual(wallCandidates('2026-11-01T01:30'), ['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z']);
  assert.throws(() => wallToIso('2026-11-01T01:30', '', 'startsAt'), /twice/);
  for (const choice of wallCandidates('2026-11-01T01:30')) assert.equal(wallToIso('2026-11-01T01:30', choice, 'startsAt'), choice);
});

test('review serialization clears nullable values and preserves zero/false/food and original instants', () => {
  const original = eventFixture({ startsAt: '2026-11-01T01:30:00.123-08:00', costCents: 0, beginnerFriendly: false, registrationDeadline: '2026-07-01T18:00:00-07:00' });
  const values = reviewValues(original);
  const choices = timeChoices(original);
  const patch = serializeReview({ ...values, location: '', registrationUrl: '', eligibility: '' }, choices, original);
  assert.equal(patch.startsAt, original.startsAt);
  assert.equal(patch.registrationDeadline, original.registrationDeadline);
  assert.equal(patch.costCents, 0); assert.equal(patch.beginnerFriendly, false);
  assert.equal(patch.location, null); assert.equal(patch.registrationUrl, null); assert.equal(patch.eligibility, null);
  for (const key of ['evidence', 'sourceKind', 'timezone', 'uncertainties']) assert.ok(!(key in patch), key);
  assert.equal(original.evidence[0].excerpt, 'Synthetic flyer: snacks advertised.');
  for (const food of ['advertised', 'not-advertised', 'unknown'] as const) assert.equal(serializeReview({ ...values, food, costCents: '', beginnerFriendly: '' }, choices, original).food, food);
  const unknown = serializeReview({ ...values, costCents: '', beginnerFriendly: '' }, choices, original);
  assert.equal(unknown.costCents, null); assert.equal(unknown.beginnerFriendly, null);
});

test('review rejects bad URLs, lengths and end-before-start; changed deadlines use LA timezone', () => {
  const original = eventFixture(); const values = reviewValues(original); const choices = timeChoices(original);
  assert.throws(() => serializeReview({ ...values, registrationUrl: 'javascript:bad()' }, choices, original));
  assert.throws(() => serializeReview({ ...values, title: 'x'.repeat(201) }, choices, original));
  assert.throws(() => serializeReview({ ...values, endsAt: '2026-11-16T17:00' }, { ...choices, endsAt: '' }, original), /after/);
  const patch = serializeReview({ ...values, registrationDeadline: '2026-07-15T18:00' }, { ...choices, registrationDeadline: '' }, original);
  assert.equal(patch.registrationDeadline, '2026-07-16T01:00:00.000Z');
});

test('image and text creation validation checks MIME, raw bytes, schema limits and required input', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) validateFile({ type, size: 1 });
  for (const file of [{ type: 'image/svg+xml', size: 100 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: 5 * 1024 * 1024 + 1 }]) assert.throws(() => validateFile(file));
  validateFile({ type: 'image/png', size: 5 * 1024 * 1024 });
  assert.throws(() => validateCreate({})); assert.throws(() => validateCreate({ text: '  ' }));
  assert.equal(validateCreate({ text: 'x'.repeat(10000) }).text?.length, 10000);
  assert.throws(() => validateCreate({ text: 'x'.repeat(10001) }));
  assert.equal(validateCreate({ imageBase64: 'A'.repeat(8000000), mimeType: 'image/png' }).imageBase64?.length, 8000000);
  assert.throws(() => validateCreate({ imageBase64: 'A'.repeat(8000001), mimeType: 'image/png' }));
  assert.throws(() => validateCreate({ imageBase64: 'AAA' }));
  assert.throws(() => validateCreate({ text: 'announcement', sourceUrl: 'ftp://example.com/file' }));
  assert.deepEqual(imagePayload('data:image/png;base64,AAA=', 'image/png'), { imageBase64: 'AAA=', mimeType: 'image/png' });
  assert.throws(() => imagePayload('not an image', 'image/png'));
  validateCreate({ text: 'synthetic announcement' }); validateCreate({ imageBase64: 'AAA=', mimeType: 'image/png' });
  validateCreate({ text: 'synthetic announcement', imageBase64: 'AAA=', mimeType: 'image/png' });
});

test('file-reader success, failure and abort are handled without hanging', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  let fail = false;
  class Reader {
    result = 'data:image/png;base64,AAA=';
    onload?: () => void; onerror?: () => void; onabort?: () => void;
    readAsDataURL() { queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
    abort() { this.onabort?.(); }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: Reader });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'FileReader', original); else Reflect.deleteProperty(globalThis, 'FileReader'); });
  const file = new File(['synthetic'], 'synthetic.png', { type: 'image/png' });
  assert.match(await readImage(file, new AbortController().signal), /^data:image\/png/);
  fail = true; await assert.rejects(readImage(file, new AbortController().signal), /Could not read/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readImage(file, controller.signal), error => error instanceof Error && error.name === 'AbortError');
});

test('single-flight gate prevents duplicates and invalidates late work across session changes', () => {
  const gate = new TaskGate(); const first = gate.begin()!;
  assert.equal(gate.begin(), null); assert.ok(first.current());
  gate.cancel(); assert.equal(first.signal.aborted, true); assert.equal(first.current(), false);
  const second = gate.begin()!;
  first.finish(); assert.ok(second.current()); assert.equal(gate.begin(), null);
  second.finish(); assert.ok(gate.begin()); gate.cancel();
});

test('session guard rejects changed/expired organizations but ignores a late aborted expiry', async t => {
  let expired = 0;
  const expire = () => expired++;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ organizationId: 'B', organizationName: 'B' }));
  await assert.rejects(requireSessionForOrganization('A', new AbortController().signal, expire), /changed/);
  assert.equal(expired, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Expired' }, { status: 401 }));
  await assert.rejects(requireSessionForOrganization('A', new AbortController().signal, expire));
  assert.equal(expired, 2);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { controller.abort(); return Response.json({ error: 'Expired' }, { status: 401 }); });
  await assert.rejects(requireSessionForOrganization('A', controller.signal, expire));
  assert.equal(expired, 2, 'an unmounted organization must not clear a later session');
});

test('publish waits for successful PATCH of latest edits, and preserves 422 missing fields', async t => {
  const calls: string[] = []; let resolvePatch!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    if (init.method === 'PATCH') { assert.deepEqual(JSON.parse(String(init.body)), { location: 'Latest location' }); return new Promise<Response>(resolve => { resolvePatch = resolve; }); }
    return Response.json({ error: 'Missing facts', missing: ['title'] }, { status: 422 });
  });
  const promise = saveDraft('test/id', { location: 'Latest location' }, true, new AbortController().signal);
  assert.equal(calls.length, 1);
  resolvePatch(Response.json({ draft: { id: 'test/id' } }));
  await assert.rejects(promise, error => error instanceof ApiError && error.status === 422 && error.missing[0] === 'title');
  assert.deepEqual(calls, ['PATCH /api/organizer/drafts/test%2Fid', 'POST /api/organizer/drafts/test%2Fid/publish']);
});

test('failed save and cancellation never send publish; save-only stops after PATCH', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'Unavailable' }, { status: 503 }); });
  await assert.rejects(saveDraft('id', {}, true, new AbortController().signal)); assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); return Response.json({ draft: { id: 'id' } }); });
  await assert.rejects(saveDraft('id', {}, true, controller.signal), error => error instanceof Error && error.name === 'AbortError'); assert.equal(calls, 1);
  calls = 0;
  assert.deepEqual(await saveDraft('id', {}, false, new AbortController().signal), { draft: { id: 'id' } }); assert.equal(calls, 1);
});

test('review markup presents manual fallback, evidence, warnings, unknown options and server missing fields', () => {
  const fixture = eventFixture({ title: '<script>bad()</script>', evidence: [{ field: 'location', excerpt: '<b>Room uncertain</b>' }], uncertainties: ['Check location', 'Unmatched warning remains visible'] });
  const draft = { id: 'draft', status: 'draft' as const, draft: fixture, organizationName: 'Synthetic org', flyerUrl: null, extractedBy: 'manual' as const, createdAt: fixture.publishedAt, updatedAt: fixture.updatedAt };
  const html = renderToStaticMarkup(<ReviewForm record={draft} busy={false} error={new ApiError(422, 'Missing facts', ['location'])} originalText="<p>synthetic announcement</p>" onSave={() => {}} onClose={() => {}} />);
  for (const text of ['Review draft', 'unavailable', 'Source evidence:', 'Room uncertain', 'Unmatched warning remains visible', 'aria-invalid="true"', 'Save and publish', 'Unknown', 'Submitted announcement']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<b>')); assert.ok(!html.includes('<p>synthetic announcement</p>'));
});


test('organizer ignores its own session broadcast and accepts changes from another tab', async () => {
  const { sessionChangedElsewhere } = await import('../src/lib/organizer-api');
  assert.equal(sessionChangedElsewhere({ type: 'changed', source: 'tab-a' }, 'tab-a'), false);
  assert.equal(sessionChangedElsewhere({ type: 'changed', source: 'tab-b' }, 'tab-a'), true);
  assert.equal(sessionChangedElsewhere('changed', 'tab-a'), true);
  for (const invalid of [null, {}, { type: 'other', source: 'tab-b' }, { type: 'changed', source: 1 }]) assert.equal(sessionChangedElsewhere(invalid, 'tab-a'), false);
});
