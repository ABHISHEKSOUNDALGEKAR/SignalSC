import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createFeedbackSummary } = await import('../feedback');

test('unconfigured summaries return computed stats without calling a provider', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected request.'); };
  try {
    const summary = await createFeedbackSummary([
      { id: 'a', eventId: 'e', rating: 5, wouldReturn: true, comment: 'Useful.', deviceKey: 'device-key-a', demo: false, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', eventId: 'e', rating: 3, wouldReturn: null, comment: 'Could be longer.', deviceKey: 'device-key-b', demo: false, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'c', eventId: 'e', rating: 4, wouldReturn: false, comment: 'Good discussion.', deviceKey: 'device-key-c', demo: false, createdAt: '2026-01-03T00:00:00.000Z' },
    ]);
    assert.equal(calls, 0);
    assert.equal(summary.averageRating, 4);
    assert.equal(summary.responseCount, 3);
    assert.deepEqual(summary.ratingCounts, { '1': 0, '2': 0, '3': 1, '4': 1, '5': 1 });
    assert.equal(summary.wouldReturnYes, 1);
    assert.equal(summary.wouldReturnNo, 1);
    assert.equal(summary.wouldReturnUnknown, 1);
    assert.deepEqual(summary.wentWell, []);
    assert.equal(summary.note, 'Written summary unavailable; stats are computed from responses.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
