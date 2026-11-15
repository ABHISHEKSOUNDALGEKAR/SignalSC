import { useEffect, useState } from 'react';
import type { ImportHealthOutcome, ImportHealthResponse } from '../../shared/api';
import { api } from './api';
import { dateLabel, ErrorNotice } from './common';

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

export function ImportHealthPanel() {
  const [data, setData] = useState<ImportHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { setData(await api.importHealth()); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Import health could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <section className="form-panel" aria-labelledby="import-health-heading">
    <div className="section-head" style={{ marginTop: 0 }}>
      <h2 id="import-health-heading">Calendar detail recovery</h2>
      <button className="btn btn-outline" onClick={() => void load()} disabled={loading}>
        {loading ? 'Loading status…' : 'Refresh status'}
      </button>
    </div>
    <p className="event-meta">Private summary of the latest upcoming-event recovery pass per calendar, not a feed availability check.
      Counts include events sharing the same source. Unknowns can be a successful result when the source states no supported details or has conflicts.</p>
    <p className="event-meta">Refreshing status never starts an import or paid retry. Eligible events are only reconsidered by an existing import, subject to shared AI budgets, capacity, and cache ownership. Cached successes are not retried; oversized sources need changed content.</p>
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
    </div>)}
  </section>;
}
