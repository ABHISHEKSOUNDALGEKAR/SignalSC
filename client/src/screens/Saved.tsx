import React, { useCallback } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { EventCard } from '../components/EventCard';
import { useSavedEvents } from '../components/SavedEvents';
import { loadSavedRecord, type SavedRecord } from '../lib/saved';
import type { ResourceState } from '../lib/resource';
import { useResource } from '../lib/useResource';

function SavedItem({ id, revision }: { id: string; revision: number }) {
  const load = useCallback((signal: AbortSignal) => loadSavedRecord(id, signal), [id, revision]);
  const { state, retry } = useResource(load);
  return <SavedRecordView id={id} state={state} retry={retry} />;
}

export function SavedRecordView({ id, state, retry }: { id: string; state: ResourceState<SavedRecord>; retry: () => void }) {
  const { setSaved } = useSavedEvents();
  if (state.status === 'success' && state.data.status === 'available') return <EventCard event={state.data.event} headingLevel={3} />;
  return <section className="panel saved-record" aria-label={`Saved event ${id}`}>
    {state.status === 'loading' ? <LoadingState message="Loading a saved event…" /> : state.status === 'error' ? <ErrorState error={state.error} onRetry={retry} />
      : <><h3>This saved event is unavailable</h3><p>The listing may have been removed or the link may no longer be valid. It stays saved until you remove it.</p><button className="button button-secondary" onClick={retry}>Check availability again</button></>}
    <p className="filter-note">Saved event ID: {id}</p>
    <button className="button button-secondary" aria-label={`Remove saved event ${id}`} onClick={() => setSaved(id, false)}>Remove from saved</button>
  </section>;
}

export function Saved({ revision = 0 }: { revision?: number }) {
  const { ids, persisted } = useSavedEvents();
  const [attempt, setAttempt] = React.useState(0);
  return <section className="saved-events" aria-labelledby="saved-heading">
    <div className="section-heading"><h2 id="saved-heading">Saved events</h2>{ids.length > 0 && <button className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>Refresh saved events</button>}</div>
    <p className="filter-note">{persisted ? 'Saved in this browser.' : 'Saved changes are currently kept in this tab only.'} Listings are checked for current details, including cancellations.</p>
    {ids.length === 0 ? <EmptyState title="No saved events yet">Choose Save on an event in Discover, Ask, or its detail page. Your saved events will appear here.</EmptyState> : <>
      <p role="status">{ids.length} saved {ids.length === 1 ? 'event' : 'events'}</p>
      <div className="event-grid saved-grid">{ids.map(id => <SavedItem key={id} id={id} revision={revision + attempt} />)}</div>
    </>}
  </section>;
}
