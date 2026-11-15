import type { FeedImportHealth } from '../../shared/api';
import { feedHealthAlertLabel, reconcileFeedAlerts } from './feed-alerts';

export const FEED_ALERT_PREFERENCES_CHANGED = 'signalsc-feed-alert-preferences';
type Source = FeedImportHealth['source'];
export type AlertSettings = {
  enabled: boolean;
  alertedSources: Source[];
  lastCompleted: Partial<Record<Source, string | null>>;
};
function settingsKey(organizationId: string) { return `signalsc-feed-alerts:v1:${organizationId}`; }
export function readAlertSettings(organizationId: string): AlertSettings {
  const raw = localStorage.getItem(settingsKey(organizationId));
  if (!raw) return { enabled: false, alertedSources: [], lastCompleted: {} };
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') throw new Error('Alert preferences unavailable.');
  const sources: Source[] = ['engagesc', 'usc-calendar'];
  return {
    enabled: data.enabled,
    alertedSources: sources.filter(source => Array.isArray(data.alertedSources) && data.alertedSources.includes(source)),
    lastCompleted: Object.fromEntries(sources.flatMap(source =>
      data.lastCompleted && (typeof data.lastCompleted[source] === 'string' || data.lastCompleted[source] === null)
        ? [[source, data.lastCompleted[source]]] : [])),
  };
}
export function setAlertsEnabled(organizationId: string, enabled: boolean) {
  const settings = readAlertSettings(organizationId);
  // Retain outage history through opt-out/opt-in to avoid re-alerting one outage.
  localStorage.setItem(settingsKey(organizationId), JSON.stringify({ ...settings, enabled }));
  window.dispatchEvent(new Event(FEED_ALERT_PREFERENCES_CHANGED));
}
export function hasEnabledFeedAlerts(): boolean {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith('signalsc-feed-alerts:v1:') && readAlertSettings(key.slice('signalsc-feed-alerts:v1:'.length)).enabled) return true;
  }
  return false;
}

export async function deliverFeedAlerts(organizationId: string, feeds: FeedImportHealth[]): Promise<void> {
  const deliver = () => {
    const settings = readAlertSettings(organizationId);
    if (!settings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const current = reconcileFeedAlerts(feeds, settings.alertedSources, settings.lastCompleted);
    const next: AlertSettings = {
      ...settings,
      alertedSources: settings.alertedSources.filter(source => current.activeSources.includes(source)),
      lastCompleted: { ...settings.lastCompleted },
    };
    // Clear recovery state even when there is no notification to send.
    localStorage.setItem(settingsKey(organizationId), JSON.stringify(next));
    for (const alert of current.notifications) {
      const source = alert.source === 'engagesc' ? 'EngageSC' : 'USC Calendar';
      const notification = new Notification(`${source} calendar needs attention`, {
        body: feedHealthAlertLabel(alert.category),
        tag: `signalsc-feed-alert:${organizationId}:${alert.source}`,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      next.alertedSources = [...new Set([...next.alertedSources, alert.source])];
      next.lastCompleted[alert.source] = feeds.find(feed => feed.source === alert.source)?.lastCompletedAt ?? null;
      try { localStorage.setItem(settingsKey(organizationId), JSON.stringify(next)); }
      catch {
        notification.close();
        throw new Error('Alert history could not be saved.');
      }
    }
  };
  if (navigator.locks) {
    await navigator.locks.request(`signalsc-feed-alert:${organizationId}`, deliver);
  } else if (document.hasFocus()) {
    // On older browsers without Web Locks, only the focused tab may deliver.
    deliver();
  }
}
