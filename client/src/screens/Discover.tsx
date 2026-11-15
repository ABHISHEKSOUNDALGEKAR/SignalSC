import React from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { getEvents } from '../lib/api';
import { useResource } from '../lib/useResource';

export function Discover() {
  const { state, retry } = useResource(getEvents);
  return <section className="panel" aria-labelledby="discover-heading">
    <div className="section-heading"><h2 id="discover-heading">The campus pulse</h2><span className="badge">Getting started</span></div>
    {state.status === 'loading' && <LoadingState message="Connecting to the event service…" />}
    {state.status === 'error' && <ErrorState error={state.error} onRetry={retry} />}
    {state.status === 'success' && <>
      <p role="status" className="service-status">Event service connected · {state.data.events.length} published events</p>
      <EmptyState title={state.data.events.length === 0 ? 'No published events yet' : 'Your event feed is next'}>
        Event cards, date groups, and filters will be available in the next build step.
      </EmptyState>
      <button className="button button-secondary" onClick={retry}>Refresh connection</button>
    </>}
    <a className="text-link" href="#event">Preview event detail layout <span aria-hidden="true">→</span></a>
  </section>;
}
