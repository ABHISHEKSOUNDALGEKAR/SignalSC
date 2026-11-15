import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  assertDegradedFlyer, assertSourceConflict, degradedFlyerCases, sourceConflictCases,
} from '../scripts/live-flyer-cases';
import type { EventDraft } from '../shared/events';

function draftFor(fixture: typeof degradedFlyerCases[number]): EventDraft {
  return {
    title: fixture.title, description: '', startsAt: fixture.startsAt, endsAt: null,
    timezone: 'America/Los_Angeles', location: fixture.location, eligibility: null,
    costCents: null, food: 'unknown', beginnerFriendly: null, registrationUrl: null,
    registrationDeadline: null, sourceUrl: null, sourceKind: 'flyer',
    evidence: [{ field: 'title', excerpt: fixture.title }],
    uncertainties: fixture.id === 'low-light' ? ['Fine print is unreadable in the dark image.'] : [],
  };
}

test('degraded flyer fixtures are real PNGs with editable synthetic sources', async () => {
  for (const fixture of degradedFlyerCases) {
    const png = await readFile(new URL(`./fixtures/${fixture.file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)],
      fixture.id === 'rotated' ? [800, 1000] : [1000, 800]);
    const svg = await readFile(new URL(`./fixtures/${fixture.file.replace('.png', '.svg')}`, import.meta.url), 'utf8');
    assert.ok(svg.includes(fixture.title));
  }
});

test('rotated flyer requires the correct visible date and venue, not a confident guess', () => {
  const fixture = degradedFlyerCases[0];
  const draft = draftFor(fixture);
  assert.doesNotThrow(() => assertDegradedFlyer(draft, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, startsAt: '2026-11-20T19:00:00-08:00' }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, location: 'Leavey Library' }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, startsAt: null }, fixture));
});

test('low-light flyer must withhold hidden facts and explain unreadability', () => {
  const fixture = degradedFlyerCases[1];
  const draft = draftFor(fixture);
  assert.doesNotThrow(() => assertDegradedFlyer(draft, fixture));
  // Even the underlying true answer is unsafe when the pixels do not support it.
  assert.throws(() => assertDegradedFlyer({ ...draft, startsAt: '2026-11-23T21:45:00-08:00' }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, location: 'Doheny Library' }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, uncertainties: [] }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, uncertainties: ['Price is unknown.'] }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, evidence: [{ field: 'location', excerpt: 'Doheny Library' }] }, fixture));
  assert.throws(() => assertDegradedFlyer({ ...draft, evidence: [] }, fixture));
});

test('neither degraded flyer may invent unprinted optional facts', () => {
  for (const fixture of degradedFlyerCases) {
    const draft = draftFor(fixture);
    for (const field of ['endsAt', 'eligibility', 'costCents', 'beginnerFriendly', 'registrationUrl', 'registrationDeadline'] as const) {
      assert.throws(() => assertDegradedFlyer({ ...draft, [field]: 'invented' }, fixture));
    }
    assert.throws(() => assertDegradedFlyer({ ...draft, food: 'advertised' }, fixture));
  }
});

test('source-conflict fixtures pair synthetic image claims with contradictory announcement text', async () => {
  for (const fixture of sourceConflictCases) {
    const png = await readFile(new URL(`./fixtures/${fixture.file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const svg = await readFile(new URL(`./fixtures/${fixture.file.replace('.png', '.svg')}`, import.meta.url), 'utf8');
    assert.ok(svg.includes(fixture.title));
    assert.ok(svg.includes(fixture.imageClaim));
    assert.ok(fixture.text.includes(fixture.announcementClaim));

    const draft = {
      ...draftFor(degradedFlyerCases[0]),
      title: fixture.title,
      startsAt: fixture.expectedStartsAt,
      location: fixture.expectedLocation,
      uncertainties: ['Flyer image and announcement text disagree about the event date. Please confirm.'],
      evidence: [{ field: 'title', excerpt: fixture.title }],
    };
    assert.doesNotThrow(() => assertSourceConflict(draft, fixture));
    if (fixture.field === 'date') {
      assert.throws(() => assertSourceConflict({ ...draft, startsAt: '2026-11-20T18:30:00-08:00' }, fixture));
    } else {
      assert.throws(() => assertSourceConflict({ ...draft, location: 'Leavey Library' }, fixture));
    }
    assert.throws(() => assertSourceConflict({ ...draft, uncertainties: [] }, fixture));
    assert.throws(() => assertSourceConflict({
      ...draft, evidence: [{ field: fixture.field, excerpt: fixture.imageClaim }],
    }, fixture));
  }
});

test('live runner refuses to start without explicit spending consent', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-ai-live.ts'], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live checks use provider credits/);
  assert.doesNotMatch(result.stdout, /PASS live/);
});
