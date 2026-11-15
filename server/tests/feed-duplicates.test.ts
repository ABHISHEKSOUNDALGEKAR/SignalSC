import assert from 'node:assert/strict';
import { test } from 'node:test';
import './setup';
import { withoutFeedDuplicates } from '../routes';
import { emptyDraft } from '../extract';
import type { EventRecord } from '../../shared/api';

function event(id: string, overrides: Partial<EventRecord>): EventRecord {
  return {
    ...emptyDraft(null), id, title: 'Trojan Farmers Market', startsAt: '2026-11-18T11:00:00-08:00',
    status: 'published', organizationName: 'USC', publishedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    flyerUrl: null, ...overrides,
  } as EventRecord;
}

test('the same feed event is listed once, keeping the copy with a location', () => {
  const listed = withoutFeedDuplicates([
    event('a', { sourceKind: 'engagesc', location: null }),
    event('b', { sourceKind: 'usc-calendar', title: 'trojan  farmers market', location: 'McCarthy Quad' }),
    event('c', { sourceKind: 'usc-calendar', startsAt: '2026-11-25T11:00:00-08:00' }),
    event('d', { sourceKind: 'flyer' }),
    event('e', { sourceKind: 'flyer' }),
  ]);
  assert.deepEqual(listed.map(e => e.id), ['b', 'c', 'd', 'e']);
});
