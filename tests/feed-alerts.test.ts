import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedImportHealth } from '../shared/api';
import { feedHealthAlert, feedHealthAlertLabel, reconcileFeedAlerts } from '../client/src/feed-alerts';

const feed = (overrides: Partial<FeedImportHealth> = {}): FeedImportHealth => ({
  source: 'engagesc',
  lastAttemptAt: '2035-01-01T00:00:00.000Z',
  lastCompletedAt: '2034-12-31T23:30:00.000Z',
  freshness: 'fresh',
  consecutiveFailures: 0,
  lastFailureCategory: null,
  fetch: { status: 'succeeded', failureCategory: null },
  eventSave: { status: 'succeeded', failureCategory: null },
  ...overrides,
});

test('first failed attempt stays quiet; a second consecutive failure alerts with only a safe category', () => {
  assert.equal(feedHealthAlert(feed({ consecutiveFailures: 1, lastFailureCategory: 'request_failed' })), null);
  const issue = feedHealthAlert(feed({ consecutiveFailures: 2, lastFailureCategory: 'invalid_feed' }));
  assert.deepEqual(issue, { source: 'engagesc', category: 'invalid_feed' });
  assert.equal(feedHealthAlertLabel(issue!.category), 'Feed content could not be read');
  assert.doesNotMatch(JSON.stringify(issue), /https?:\/\/|error body|access_token/i);
});

test('staleness alerts even before two recent failures and identifies missing completion safely', () => {
  assert.deepEqual(feedHealthAlert(feed({
    freshness: 'stale', consecutiveFailures: 0, lastFailureCategory: null,
  })), { source: 'engagesc', category: 'stale' });
  assert.deepEqual(feedHealthAlert(feed({
    freshness: 'never', lastCompletedAt: null, consecutiveFailures: 2, lastFailureCategory: null,
  })), { source: 'engagesc', category: 'never_completed' });
});

test('one active outage alerts once, category changes do not repeat, recovery resets deduplication', () => {
  const initial = feed({ freshness: 'stale', consecutiveFailures: 2, lastFailureCategory: 'request_failed' });
  const first = reconcileFeedAlerts([initial], []);
  assert.deepEqual(first.notifications, [{ source: 'engagesc', category: 'request_failed' }]);
  const continuing = feed({ ...initial, lastFailureCategory: 'invalid_feed', fetch: { status: 'failed', failureCategory: 'invalid_feed' } });
  const repeated = reconcileFeedAlerts([continuing], first.activeSources);
  assert.deepEqual(repeated.activeSources, ['engagesc']);
  assert.deepEqual(repeated.notifications, []);
  const recovery = reconcileFeedAlerts([feed()], repeated.activeSources);
  assert.deepEqual(recovery.activeSources, []);
  assert.deepEqual(recovery.notifications, []);
  const nextOutage = reconcileFeedAlerts([initial], recovery.activeSources);
  assert.deepEqual(nextOutage.notifications, [{ source: 'engagesc', category: 'request_failed' }]);
});

test('independent calendars alert and recover independently', () => {
  const engagesc = feed({ freshness: 'stale', consecutiveFailures: 3, lastFailureCategory: 'event_save_failed' });
  const usc = feed({ source: 'usc-calendar', consecutiveFailures: 2, lastFailureCategory: 'request_failed' });
  const active = reconcileFeedAlerts([engagesc, usc], []);
  assert.deepEqual(active.notifications.map(item => item.source), ['engagesc', 'usc-calendar']);
  const oneRecovered = reconcileFeedAlerts([feed(), usc], active.activeSources);
  assert.deepEqual(oneRecovered.activeSources, ['usc-calendar']);
  assert.deepEqual(oneRecovered.notifications, []);
});
