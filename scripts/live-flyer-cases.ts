import assert from 'node:assert/strict';
import type { EventDraft } from '../shared/events';

// Data and assertions only: importing this module never calls a provider.
export const degradedFlyerCases = [
  {
    id: 'rotated',
    file: 'live-flyer-rotated.png',
    source: 'Orbit Sketch Night November 22, 2026 8:15 PM TCC 450',
    title: 'Orbit Sketch Night',
    startsAt: '2026-11-22T20:15:00-08:00',
    location: 'TCC 450',
  },
  {
    id: 'low-light',
    file: 'live-flyer-low-light.png',
    source: 'Lantern Poetry Circle November 23, 2026 9:45 PM Doheny Library',
    title: 'Lantern Poetry Circle',
    // Ground truth exists in the SVG, but the PNG fine print is unreadable.
    // Recovering it by guessing must not count as a successful extraction.
    startsAt: null,
    location: null,
  },
] as const;

export function assertDegradedFlyer(draft: EventDraft, fixture: typeof degradedFlyerCases[number]) {
  const label = `${fixture.id} flyer`;
  assert.equal(draft.title, fixture.title, `${label}: readable title must be retained`);
  assert.equal(draft.startsAt, fixture.startsAt, `${label}: start must match visible facts or remain unknown`);
  assert.equal(draft.location, fixture.location, `${label}: venue must match visible facts or remain unknown`);
  for (const field of ['endsAt', 'eligibility', 'costCents', 'beginnerFriendly', 'registrationUrl', 'registrationDeadline'] as const) {
    assert.equal(draft[field], null, `${label}: unprinted ${field} must remain unknown`);
  }
  assert.notEqual(draft.food, 'advertised', `${label}: unprinted food must not be invented`);
  if (fixture.id === 'low-light') {
    assert.ok(draft.uncertainties.some(note => /dark|dim|light|shadow|unread|illegib/i.test(note)),
      `${label}: unreadable or poorly lit details must be flagged`);
    // Hidden fine print cannot be cited as if it were visible evidence.
    assert.ok(draft.evidence.length, `${label}: readable title needs source evidence`);
    for (const item of draft.evidence) {
      const excerpt = item.excerpt.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      assert.ok(excerpt && fixture.title.toLowerCase().includes(excerpt),
        `${label}: evidence may only quote the readable title`);
    }
  }
}
