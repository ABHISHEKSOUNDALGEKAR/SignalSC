import type { FeedImportAlertCategory, FeedImportHealth } from '../../shared/api';

export type FeedHealthAlert = {
  source: FeedImportHealth['source'];
  category: FeedImportAlertCategory;
};

export type FeedAlertState = { activeSources: FeedImportHealth['source'][]; notifications: FeedHealthAlert[] };

export function feedHealthAlert(feed: FeedImportHealth): FeedHealthAlert | null {
  if (feed.freshness === 'stale') return { source: feed.source, category: feed.lastFailureCategory ?? 'stale' };
  if (feed.consecutiveFailures >= 2) {
    return { source: feed.source, category: feed.lastFailureCategory ?? 'never_completed' };
  }
  return null;
}

export function reconcileFeedAlerts(
  feeds: FeedImportHealth[],
  previouslyAlerted: FeedImportHealth['source'][],
  previousCompletions: Partial<Record<FeedImportHealth['source'], string | null>> = {},
): FeedAlertState {
  const active = feeds.flatMap(feed => {
    const alert = feedHealthAlert(feed);
    return alert ? [alert] : [];
  });
  const previously = new Set(previouslyAlerted);
  return {
    activeSources: active.map(alert => alert.source),
    notifications: active.filter(alert => !previously.has(alert.source)
      || (Object.hasOwn(previousCompletions, alert.source)
        && previousCompletions[alert.source] !== feeds.find(feed => feed.source === alert.source)?.lastCompletedAt)),
  };
}

export function feedHealthAlertLabel(category: FeedImportAlertCategory): string {
  const labels: Record<FeedImportAlertCategory, string> = {
    request_failed: 'Feed request failed',
    invalid_feed: 'Feed content could not be read',
    event_save_failed: 'Event records could not be saved',
    stale: 'No completed import in over two hours',
    never_completed: 'No completed import has been recorded',
  };
  return labels[category];
}

