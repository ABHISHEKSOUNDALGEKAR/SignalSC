import type { FeedImportAlertCategory, FeedImportFailureCategory, FeedImportHealth } from '../../shared/api';

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
): FeedAlertState {
  const active = feeds.flatMap(feed => {
    const alert = feedHealthAlert(feed);
    return alert ? [alert] : [];
  });
  const previously = new Set(previouslyAlerted);
  return {
    activeSources: active.map(alert => alert.source),
    notifications: active.filter(alert => !previously.has(alert.source)),
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

export function feedFailureCategory(feed: FeedImportHealth): FeedImportFailureCategory | null {
  return feed.lastFailureCategory;
}
