import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertMultilingualFlyer, multilingualFlyers, type MultilingualFlyer } from '../scripts/multilingual-flyer-cases';
import type { EventDraft } from '../shared/events';

function draftFor(fixture: MultilingualFlyer): EventDraft {
  return {
    ...fixture.expected,
    title: fixture.sourceLines[0], description: '',
    timezone: 'America/Los_Angeles', food: 'unknown',
    registrationUrl: null, registrationDeadline: null,
    sourceUrl: null, sourceKind: 'flyer',
    evidence: [
      { field: 'title', excerpt: fixture.sourceLines[0] },
      ...(fixture.expected.eligibility
        ? [{ field: 'eligibility', excerpt: fixture.expected.eligibility }] : []),
    ],
    uncertainties: fixture.uncertainty === 'date' ? ['Event date is ambiguous: 25 or 26 November.']
      : fixture.uncertainty === 'location' ? ['Location has not been announced.'] : [],
  };
}

test('multilingual sources have aligned reference translations and matching PNG/SVG fixtures', async () => {
  for (const fixture of multilingualFlyers) {
    assert.equal(fixture.sourceLines.length, fixture.englishLines.length);
    assert.ok(fixture.englishLines.every(line => line.length > 0));
    const svg = await readFile(new URL(`./fixtures/${fixture.file.replace('.png', '.svg')}`, import.meta.url), 'utf8');
    const printedLines = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
    assert.deepEqual(printedLines, [...fixture.sourceLines], 'reference transcript must match all printed text in order');
    const png = await readFile(new URL(`./fixtures/${fixture.file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 800]);
    assert.doesNotThrow(() => assertMultilingualFlyer(draftFor(fixture), fixture));
  }
});

test('multilingual assertions reject mistranslated dates, times, venues, prices and suitability', () => {
  for (const fixture of multilingualFlyers) {
    const draft = draftFor(fixture);
    const wrong: Partial<EventDraft>[] = [
      { startsAt: '2026-11-24T06:30:00-08:00' },
      { endsAt: '2026-11-24T08:00:00-08:00' },
      { location: 'Invented Hall' },
      { costCents: 999 },
      { beginnerFriendly: fixture.expected.beginnerFriendly === true ? false : true },
    ];
    for (const change of wrong) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, ...change }, fixture));
    }
    if (draft.startsAt) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, startsAt: null }, fixture));
    }
    if (draft.endsAt) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, endsAt: null }, fixture));
    }
    assert.throws(() => assertMultilingualFlyer({ ...draft, timezone: 'Europe/Paris' } as unknown as EventDraft, fixture));
  }
});

test('decimal-comma price and negative attendance/food statements cannot be reversed', () => {
  const fixture = multilingualFlyers[0];
  const draft = draftFor(fixture);
  for (const costCents of [0, 7, 75, 7500, null]) {
    assert.throws(() => assertMultilingualFlyer({ ...draft, costCents }, fixture));
  }
  for (const eligibility of [null, 'Open to all', 'USC students only']) {
    assert.throws(() => assertMultilingualFlyer({ ...draft, eligibility }, fixture));
  }
  assert.doesNotThrow(() => assertMultilingualFlyer({ ...draft, eligibility: 'Club members only' }, fixture));
  assert.throws(() => assertMultilingualFlyer({
    ...draft, evidence: draft.evidence.filter(item => item.field !== 'eligibility'),
  }, fixture));
});

test('missing facts cannot become free admission, food, attendance restrictions or registration', () => {
  for (const fixture of multilingualFlyers) {
    const draft = draftFor(fixture);
    assert.throws(() => assertMultilingualFlyer({ ...draft, food: 'advertised' }, fixture));
    assert.throws(() => assertMultilingualFlyer({ ...draft, registrationUrl: 'https://example.com/rsvp' }, fixture));
    assert.throws(() => assertMultilingualFlyer({ ...draft, registrationDeadline: '2026-11-24T17:00:00-08:00' }, fixture));
    if (!fixture.expected.eligibility) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, eligibility: 'Club members only' }, fixture));
    }
    if (fixture.expected.costCents === null) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, costCents: 0 }, fixture));
    }
  }
});

test('conflicting dates and unannounced venue require relevant warnings, not generic missing details', () => {
  for (const fixture of multilingualFlyers.filter(f => f.uncertainty)) {
    const draft = draftFor(fixture);
    for (const uncertainties of [[], ['Price is unknown.'], ['Please review the flyer.']]) {
      assert.throws(() => assertMultilingualFlyer({ ...draft, uncertainties }, fixture));
    }
  }
});

test('evidence must quote original-language text, never invented facts or the reference translation', () => {
  for (const fixture of multilingualFlyers) {
    const draft = draftFor(fixture);
    assert.throws(() => assertMultilingualFlyer({ ...draft, evidence: [] }, fixture));
    for (const excerpt of ['', 'Invented venue', fixture.englishLines[0]]) {
      assert.throws(() => assertMultilingualFlyer({
        ...draft, evidence: [...draft.evidence, { field: 'title', excerpt }],
      }, fixture));
    }
  }
});
