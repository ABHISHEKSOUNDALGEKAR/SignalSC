import assert from 'node:assert/strict';
import type { EventDraft } from '../shared/events';
export { multilingualFlyers } from '../tests/fixtures/multilingual-flyers';
import { multilingualFlyers } from '../tests/fixtures/multilingual-flyers';

export type MultilingualFlyer = typeof multilingualFlyers[number];
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Data and assertions only. Safe to import during automatic offline validation.
export function assertMultilingualFlyer(draft: EventDraft, fixture: MultilingualFlyer) {
  const label = `${fixture.id} flyer`;
  for (const field of ['startsAt', 'endsAt', 'location', 'costCents', 'beginnerFriendly'] as const) {
    assert.equal(draft[field], fixture.expected[field], `${label}: ${field} must match printed facts`);
  }
  assert.equal(draft.timezone, 'America/Los_Angeles', `${label}: language must not change the campus timezone`);
  if (fixture.expected.eligibility === null) {
    assert.equal(draft.eligibility, null, `${label}: unprinted attendance restrictions must remain unknown`);
  } else {
    assert.ok(draft.eligibility, `${label}: printed attendance restriction must be retained`);
    // The prompt asks for eligibility "as written"; allow the literal reference
    // translation too, but not a reversal such as "open to all".
    assert.ok([fixture.expected.eligibility, fixture.englishLines[5]].some(
      value => value !== undefined && normalize(value) === normalize(draft.eligibility!)),
    `${label}: club-members-only restriction must not be mistranslated`);
    assert.ok(draft.evidence.some(item => item.field === 'eligibility' &&
      normalize(item.excerpt) === normalize(fixture.expected.eligibility!)),
    `${label}: attendance restriction needs the original source quote`);
  }
  for (const field of ['registrationUrl', 'registrationDeadline'] as const) {
    assert.equal(draft[field], null, `${label}: unprinted ${field} must remain unknown`);
  }
  assert.notEqual(draft.food, 'advertised', `${label}: food must not be invented or a negation reversed`);
  assert.ok(draft.evidence.length, `${label}: source evidence is required`);
  const source = normalize(fixture.sourceLines.join('\n'));
  for (const item of draft.evidence) {
    const excerpt = normalize(item.excerpt);
    assert.ok(excerpt && source.includes(excerpt), `${label}: evidence must quote original source, not the English translation`);
  }
  if (fixture.uncertainty === 'date') {
    assert.ok(draft.uncertainties.some(note =>
      /(?:date|jour).*(?:conflict|ambig|confirm|uncertain|incertain|25|26)|(?:conflict|ambig|confirm|uncertain|incertain).*(?:date|jour)/i.test(note)),
    `${label}: conflicting dates need a date-specific uncertainty`);
  } else if (fixture.uncertainty === 'location') {
    assert.ok(draft.uncertainties.some(note =>
      /(?:location|venue|ort).*(?:unknown|missing|announc|not|confirm|unbekannt|fehlt)|(?:no|unknown|missing).*(?:location|venue)|bekannt gegeben/i.test(note)),
    `${label}: unannounced venue needs a location-specific uncertainty`);
  }
}
