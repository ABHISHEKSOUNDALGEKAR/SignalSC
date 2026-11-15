import { useEffect } from 'react';
import { api, ApiError } from './api';
import { deliverFeedAlerts, FEED_ALERT_PREFERENCES_CHANGED, hasEnabledFeedAlerts, readAlertSettings } from './feed-alert-delivery';

// Monitoring is independent of the status panel and never triggers an import.
export function FeedAlertMonitor() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        if (!hasEnabledFeedAlerts() || !('Notification' in window) || Notification.permission !== 'granted') return;
        const session = await api.session();
        if (stopped || !readAlertSettings(session.organizationId).enabled) return;
        const health = await api.importHealth();
        if (!stopped) await deliverFeedAlerts(session.organizationId, health.feedImports);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          console.warn('Calendar alert check unavailable; the next check will retry.');
        }
      } finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 60_000);
    const refresh = () => { void check(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('hashchange', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener(FEED_ALERT_PREFERENCES_CHANGED, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('hashchange', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(FEED_ALERT_PREFERENCES_CHANGED, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return null;
}
