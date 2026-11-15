import assert from 'node:assert/strict';
import type { EventRecord } from '../shared/api';
import { emptyDraft } from '../server/extract';
import { modelConfigured } from '../server/model';
import { interpretWithRules, search } from '../server/search';
import { startOfCampusDay, toCampusIso } from '../server/time';

async function main() {
  if (!process.argv.includes('--confirm-live')) throw new Error('Live checks require --confirm-live and may use provider credits.');
  assert.equal(modelConfigured, true, 'A configured model is required.');
  const now = new Date();
  const nextWeek = new Date(interpretWithRules('next week', now).from);
  const start = new Date(startOfCampusDay(nextWeek, 1).getTime() + 18 * 60 * 60_000);
  const fixture: EventRecord = {
    ...emptyDraft(null), id: 'synthetic-search-event', title: 'Community Dinner',
    description: 'Food advertised. Admission price and beginner suitability are not listed.',
    startsAt: toCampusIso(start), endsAt: toCampusIso(new Date(start.getTime() + 3_600_000)),
    status: 'published', food: 'advertised', costCents: null, beginnerFriendly: null,
    organizationName: 'Synthetic Verification Org', flyerUrl: null,
    publishedAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  const food = await search('free food next week', [fixture], now);
  assert.equal(food.interpretedBy, 'model');
  assert.equal(food.fallbackReason, undefined);
  assert.equal(food.constraints.freeOnly, false);
  assert.equal(food.constraints.afterMinutes, null);
  assert.equal(food.constraints.from, toCampusIso(nextWeek));
  assert.equal(food.results[0]?.event.id, fixture.id);
  console.log('PASS live free-food search: correct week, unknown admission accepted, model interpretation and summary completed.');

  const beginner = await search('beginner-friendly events next week', [fixture], now);
  assert.equal(beginner.interpretedBy, 'model');
  assert.equal(beginner.fallbackReason, undefined);
  assert.equal(beginner.noMatch, true);
  assert.deepEqual(beginner.constraints.keywords, []);
  assert.deepEqual(beginner.relatedResults?.[0]?.differences, ['Beginner suitability not listed']);
  console.log('PASS live related suggestions: unknown suitability disclosed, no invented exact matches, model summary completed.');
  console.log('PASS isolated synthetic checks only; no public events or database writes.');
}

main().catch(() => {
  console.error('FAIL live search verification. Only controlled synthetic inputs were used; provider output is withheld.');
  process.exitCode = 1;
});
