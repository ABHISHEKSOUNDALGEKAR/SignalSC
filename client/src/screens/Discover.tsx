import React, { useCallback, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { EventCard } from '../components/EventCard';
import { getEvents } from '../lib/api';
import { groupEvents, initialFilters, type Filters } from '../lib/events';
import { useResource } from '../lib/useResource';

export function Discover() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const load = useCallback((signal: AbortSignal) => getEvents(signal, filters), [filters]);
  const { state, retry } = useResource(load);
  const filtered = filters.date !== 'all' || filters.free || filters.food;
  return <section className="discover" aria-labelledby="discover-heading">
    <div className="section-heading"><h2 id="discover-heading">The campus pulse</h2><button className="button button-secondary" onClick={retry}>Refresh events</button></div>
    <p className="filter-note">Upcoming and ongoing · Los Angeles time. This week runs Monday–Sunday.</p>
    <div className="filters" role="group" aria-label="Filter events">
      <button aria-pressed={filters.date === 'today'} onClick={() => setFilters(f => ({ ...f, date: f.date === 'today' ? 'all' : 'today' }))}>Today</button>
      <button aria-pressed={filters.date === 'week'} onClick={() => setFilters(f => ({ ...f, date: f.date === 'week' ? 'all' : 'week' }))}>This week</button>
      <button aria-pressed={filters.free} onClick={() => setFilters(f => ({ ...f, free: !f.free }))}>Free</button>
      <button aria-pressed={filters.food} onClick={() => setFilters(f => ({ ...f, food: !f.food }))}>Food advertised</button>
      {filtered && <button className="reset-filter" onClick={() => setFilters(initialFilters)}>Reset filters</button>}
    </div>
    {state.status === 'loading' && <LoadingState message="Finding campus events…" />}
    {state.status === 'error' && <ErrorState error={state.error} onRetry={retry} />}
    {state.status === 'success' && <>
      <p role="status" className="service-status">{state.data.events.length} {state.data.events.length === 1 ? 'event' : 'events'} found</p>
      {state.data.events.length === 0 ? <EmptyState title={filtered ? 'No events match these filters' : 'No upcoming events yet'}>
        {filtered ? 'Try resetting a filter to see more events.' : 'Check back for newly published campus events.'}
      </EmptyState> : groupEvents(state.data.events).map(([key, group]) => <section key={key} className="date-group" aria-label={group.label}>
        <h3 className="date-heading">{group.label}</h3><div className="event-grid">{group.events.map(event => <EventCard key={event.id} event={event} />)}</div>
      </section>)}
    </>}
  </section>;
}
