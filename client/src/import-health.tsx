import { useEffect, useRef, useState } from 'react';
import type {
  FeedImportFailureCategory, FeedImportHealth, ImportHealthOutcome, ImportHealthResponse,
  ImportedEventSource, OversizedImportedEvent,
} from '../../shared/api';
import { api } from './api';
import { dateLabel, ErrorNotice } from './common';
import { feedHealthAlert, feedHealthAlertLabel, reconcileFeedAlerts } from './feed-alerts';

type AlertSettings = { enabled: boolean; alertedSources: ('engagesc' | 'usc-calendar')[] };
function settingsKey(organizationId: string) { return `signalsc-feed-alerts:v1:${organizationId}`; }
function readAlertSettings(organizationId: string): AlertSettings {
  try {
    const data = JSON.parse(localStorage.getItem(settingsKey(organizationId)) ?? 'null');
    if (data && typeof data === 'object') return {
      enabled: data.enabled === true,
      alertedSources: Array.isArray(data.alertedSources)
        ? data.alertedSources.filter((source: unknown): source is AlertSettings['alertedSources'][number] => source === 'engagesc' || source === 'usc-calendar')
        : [],
    };
  } catch { /* Corrupt or blocked storage keeps alerts off. */ }
  return { enabled: false, alertedSources: [] };
}
function writeAlertSettings(organizationId: string, settings: AlertSettings) {
  localStorage.setItem(settingsKey(organizationId), JSON.stringify(settings));
}

const feedFailureLabels: Record<FeedImportFailureCategory, string> = {
  request_failed: 'Feed request failed',
  invalid_feed: 'Feed content could not be read',
  event_save_failed: 'Event records could not be saved',
};
function feedStageLabel(status: string, failureCategory: FeedImportFailureCategory | null) {
  if (failureCategory) return `Failed — ${feedFailureLabels[failureCategory]}`;
  switch (status) {
    case 'pending': return 'In progress';
    case 'succeeded': return 'Succeeded';
    case 'not_attempted': return 'Not reached on the latest attempt';
    default: return 'Unknown';
  }
}
function freshnessLabel(feed: FeedImportHealth) {
  switch (feed.freshness) {
    case 'fresh': return 'Fresh (completed within two hours)';
    case 'stale': return 'Stale (last completion was over two hours ago)';
    case 'never': return 'No completed import recorded';
  }
}

const labels: Record<ImportHealthOutcome, string> = {
  recovered: 'Checked successfully',
  cached: 'Reused successful details',
  cached_unknown: 'Reused successful unknowns',
  provider_failure: 'Provider request failed',
  invalid_response: 'Provider response unusable',
  cooldown: 'Waiting for retry cooldown',
  busy: 'Another importer held the recovery lease',
  oversized: 'Source exceeded the safe size limit',
  capacity: 'Rejected by usage or concurrency limits',
  coordination_failure: 'Recovery coordination unavailable',
  not_configured: 'AI recovery not configured',
  deferred: 'Not attempted after an earlier batch stopped',
};

export function ImportHealthPanel({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<ImportHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertStorageError, setAlertStorageError] = useState(false);
  const requestInFlight = useRef(false);
  function notifyForHealth(response: ImportHealthResponse) {
    const settings = readAlertSettings(organizationId);
    if (!settings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const current = reconcileFeedAlerts(response.feedImports, settings.alertedSources);
    // Persist the active outage set before displaying anything. Another organizer tab
    // sees this update and will not send the same alert again.
    writeAlertSettings(organizationId, { enabled: true, alertedSources: current.activeSources });
    for (const alert of current.notifications) {
      const source = alert.source === 'engagesc' ? 'EngageSC' : 'USC Calendar';
      try {
        const notification = new Notification(`${source} calendar needs attention`, {
          body: feedHealthAlertLabel(alert.category),
          tag: `signalsc-feed-alert:${organizationId}:${alert.source}`,
        });
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch { setAlertMessage('The browser could not show a notification. Check this calendar’s status below.'); }
    }
  }
  const [oversized, setOversized] = useState<Partial<Record<ImportedEventSource, OversizedImportedEvent[]>>>({});
  const [oversizedLoading, setOversizedLoading] = useState<ImportedEventSource | null>(null);
  const [oversizedErrors, setOversizedErrors] = useState<Partial<Record<ImportedEventSource, string>>>({});
  async function load() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true); setError('');
    try {
      const response = await api.importHealth();
      setData(response);
      try { notifyForHealth(response); } catch { setAlertStorageError(true); }
    }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Import health could not be loaded.'); }
    finally { requestInFlight.current = false; setLoading(false); }
  }
  useEffect(() => {
    try { setAlertsEnabled(readAlertSettings(organizationId).enabled); } catch { setAlertStorageError(true); }
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [organizationId]);
  async function enableAlerts() {
    setAlertMessage('');
    if (!('Notification' in window)) {
      setAlertMessage('This browser does not support notifications. The status page will continue updating while open.');
      return;
    }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') {
        setAlertMessage(permission === 'denied'
          ? 'Notifications are blocked in browser settings. Allow them for SignalSC, then try again.'
          : 'Notification permission was not granted. You can enable it in browser settings.');
        return;
      }
      const settings = readAlertSettings(organizationId);
      writeAlertSettings(organizationId, { ...settings, enabled: true });
      setAlertsEnabled(true);
      if (data) notifyForHealth(data);
      setAlertMessage('Browser alerts are on. Keep SignalSC open and signed in to receive them.');
    } catch {
      setAlertStorageError(true);
      setAlertMessage('Alerts could not be saved in this browser. Allow site storage and try again.');
    }
  }
  function disableAlerts() {
    try {
      writeAlertSettings(organizationId, { enabled: false, alertedSources: [] });
      setAlertsEnabled(false);
      setAlertMessage('Browser alerts are off.');
      setAlertStorageError(false);
    } catch {
      setAlertStorageError(true);
      setAlertMessage('The alert preference could not be changed. Allow site storage and try again.');
    }
  }
  async function loadOversized(source: ImportedEventSource) {
    setOversizedLoading(source);
    setOversizedErrors(previous => ({ ...previous, [source]: undefined }));
    try {
      const result = await api.oversizedImportedEvents(source);
      setOversized(previous => ({ ...previous, [source]: result.events }));
    } catch (e) {
      setOversizedErrors(previous => ({
        ...previous,
        [source]: e instanceof Error ? e.message : 'Oversized listings could not be loaded.',
      }));
    } finally { setOversizedLoading(null); }
  }
  return <section className="form-panel" aria-labelledby="import-health-heading">
    <div className="section-head" style={{ marginTop: 0 }}>
      <h2 id="import-health-heading">Calendar import health</h2>
      <button className="btn btn-outline" onClick={() => void load()} disabled={loading}>
        {loading ? 'Loading status…' : 'Refresh status'}
      </button>
    </div>
    <h3>Feed imports</h3>
    <p className="event-meta">Feed fetching and event saving are reported separately from AI detail recovery. Status contains safe categories only; feed URLs and raw errors are never shown. Freshness reflects the last fully completed feed import.</p>
    <div className="import-alert-controls">
      <div><strong>Calendar health alerts</strong><p className="event-meta">Opt in to browser notifications for stale feeds or two consecutive failures. Checks run while you are signed in with this page open.</p></div>
      {alertsEnabled
        ? <button className="btn btn-outline" type="button" onClick={disableAlerts}>Turn off alerts</button>
        : <button className="btn btn-primary" type="button" onClick={() => void enableAlerts()}>Enable browser alerts</button>}
    </div>
    {alertStorageError && <div className="inline-message" role="alert">Browser storage is unavailable, so alert preferences and duplicate protection may not persist.</div>}
    {alertMessage && <p className="event-meta" role="status">{alertMessage}</p>}
    {data && data.feedImports.length === 0 && <p>No feed import status recorded yet. The next scheduled import will record a summary.</p>}
    {data?.feedImports.map(feed => <div key={feed.source} className="source-card">
      <h3>{feed.source === 'engagesc' ? 'EngageSC' : 'USC Calendar'}</h3>
      <p className="event-meta">
        Latest attempt: {dateLabel(feed.lastAttemptAt)}<br />
        Last completed feed import: {feed.lastCompletedAt ? dateLabel(feed.lastCompletedAt) : 'Not recorded'}<br />
        Freshness: {freshnessLabel(feed)}
      </p>
      <ul>
        <li><strong>Feed fetch:</strong> {feedStageLabel(feed.fetch.status, feed.fetch.failureCategory)}</li>
        <li><strong>Event saving:</strong> {feedStageLabel(feed.eventSave.status, feed.eventSave.failureCategory)}</li>
        <li><strong>Consecutive failed imports:</strong> {feed.consecutiveFailures}</li>
        {feedHealthAlert(feed) && <li className="inline-message"><strong>Alert condition:</strong> {feedHealthAlertLabel(feedHealthAlert(feed)!.category)}</li>}
      </ul>
    </div>)}
    <h3>AI detail recovery</h3>
    <p className="event-meta">Private summary of the latest upcoming-event recovery pass per calendar, not a feed availability check.
      Counts include events sharing the same source. Unknowns can be a successful result when the source states no supported details or has conflicts.</p>
    <p className="event-meta">Refreshing status and finding oversized listings never starts an import or paid retry. Correct an oversized listing’s public description; a later existing import will recheck it under the usual shared AI limits. Cached successes are not retried.</p>
    {error && <ErrorNotice error={error} retry={() => void load()} />}
    {data && !data.modelConfigured && <p className="inline-message">AI recovery is not configured. No paid recovery calls can run.</p>}
    {data && data.runs.length === 0 && <p>No recovery status recorded yet. The next scheduled import will record a summary.</p>}
    {data?.runs.map(run => <div key={run.source} className="source-card">
      <h3>{run.source === 'engagesc' ? 'EngageSC' : 'USC Calendar'}</h3>
      <p className="event-meta">Latest pass: {dateLabel(run.checkedAt)} · {run.eventCount} upcoming events<br />
        Last successful recovery: {run.lastSuccessAt ? dateLabel(run.lastSuccessAt) : 'Not recorded (older cache entries may predate tracking)'}</p>
      {run.outcomes.length === 0 ? <p>No upcoming events required recovery.</p> :
        <ul>{run.outcomes.map(row => <li key={row.outcome}>
          <strong>{labels[row.outcome]}: {row.count}</strong>
          {row.retryEligible > 0 && <span> · {row.retryEligible} eligible for a later import check</span>}
          {row.nextRetryAt && <span> · Earliest retry check: {dateLabel(row.nextRetryAt)}</span>}
          {row.outcome === 'busy' && !row.nextRetryAt && <span> · Eligibility will be checked on the next import</span>}
        </li>)}</ul>}
      {(run.outcomes.find(row => row.outcome === 'oversized')?.count ?? 0) > 0 && <>
        <button className="btn btn-outline" onClick={() => void loadOversized(run.source)}
          disabled={oversizedLoading !== null}>
          {oversizedLoading === run.source ? 'Finding listings…' : 'Find oversized listings'}
        </button>
        {oversizedErrors[run.source] && <p className="inline-message" role="alert">{oversizedErrors[run.source]}</p>}
        {oversized[run.source] && (oversized[run.source]!.length === 0
          ? <p>No matching upcoming public listings were found. The latest feed may have changed.</p>
          : <ul aria-label="Oversized imported listings">{oversized[run.source]!.map(event =>
            <li key={event.id}>
              <a href={`#/event/${encodeURIComponent(event.id)}`}>{event.title}</a>
              {' · '}{dateLabel(event.startsAt)} · ID: <code>{event.id}</code>
            </li>)}</ul>)}
      </>}
    </div>)}
  </section>;
}
