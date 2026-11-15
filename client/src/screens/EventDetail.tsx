import React, { useCallback, useState } from 'react';
import type { EventRecord } from '../../../shared/api';
import { ApiError, getEvent } from '../lib/api';
import { confirmationLabel, costLabel, dateLabel, foodLabel, sourceLabel, webUrl } from '../lib/events';
import { useResource } from '../lib/useResource';
import { EmptyState, ErrorState, FieldDisplay, LoadingState } from '../components/States';

function Flyer({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  const safe = url?.startsWith('/api/flyers/') ? url : webUrl(url);
  if (!safe) return <p>Flyer: Unknown</p>;
  return failed ? <p role="status">The flyer image could not be loaded.</p> : <img className="flyer" src={safe} alt="Original event flyer; event details and source evidence are provided as text on this page." onError={() => setFailed(true)} />;
}

export function EventInformation({ event }: { event: EventRecord }) {
  const source = webUrl(event.sourceUrl);
  const registration = webUrl(event.registrationUrl);
  const cancelled = event.status === 'cancelled';
  return <>
    <div className="section-heading"><span className="badge">{confirmationLabel(event)}</span>{cancelled && <strong className="cancelled" role="status">Cancelled</strong>}</div>
    <h2 className="event-title">{event.title}</h2>
    {cancelled && <p className="cancellation-note">This event has been cancelled. Check the original source for updates.</p>}
    <p className="detail-description">{event.description || 'Unknown'}</p>
    <div className="event-actions" aria-label="Event actions">
      <a className="button" href={`/api/events/${encodeURIComponent(event.id)}/calendar.ics`}>Add to calendar</a>
      {registration && !cancelled && <a className="button button-secondary" href={registration} target="_blank" rel="noopener noreferrer">Register <span className="sr-only">(opens in a new tab)</span></a>}
    </div>
    <p className="save-pending">Saving events will be available in a later update.</p>
    <dl className="facts detail-facts">
      <FieldDisplay label="Starts" value={dateLabel(event.startsAt)} /><FieldDisplay label="Ends" value={dateLabel(event.endsAt)} />
      <FieldDisplay label="Timezone" value={event.timezone} /><FieldDisplay label="Location" value={event.location} />
      <FieldDisplay label="Organization" value={event.organizationName} /><FieldDisplay label="Eligibility" value={event.eligibility} />
      <FieldDisplay label="Admission" value={costLabel(event.costCents)} /><FieldDisplay label="Food" value={foodLabel(event.food)} />
      <FieldDisplay label="Beginner-friendly" value={event.beginnerFriendly} /><FieldDisplay label="Registration deadline" value={dateLabel(event.registrationDeadline)} />
      <FieldDisplay label="Registration link" value={registration ? <a href={registration} target="_blank" rel="noopener noreferrer">Official registration <span className="sr-only">(opens in a new tab)</span></a> : null} />
      <FieldDisplay label="Source type" value={sourceLabel(event.sourceKind)} /><FieldDisplay label="Published" value={dateLabel(event.publishedAt)} /><FieldDisplay label="Last updated" value={dateLabel(event.updatedAt)} />
    </dl>
    <p className="filter-note">“Not advertised” means the checked source did not offer food. It does not mean there will be no food. Confirmation describes a listing review, not a guarantee that the event will happen.</p>
    <section className="detail-section"><h3>Original source</h3>{source ? <a className="text-link source-link" href={source} target="_blank" rel="noopener noreferrer">{source}<span className="sr-only"> (opens in a new tab)</span></a> : <p>Source link: Unknown</p>}
      <Flyer key={event.flyerUrl} url={event.flyerUrl} />
    </section>
    <section className="detail-section"><h3>Source evidence</h3>{event.evidence.length ? <dl>{event.evidence.map((item, index) => <FieldDisplay key={index} label={item.field} value={item.excerpt} />)}</dl> : <p>Unknown</p>}</section>
    <section className="detail-section"><h3>Uncertainties</h3>{event.uncertainties.length ? <ul>{event.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No uncertainties listed in the record.</p>}</section>
  </>;
}

function LoadedDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getEvent(id, signal), [id]);
  const { state, retry } = useResource(load);
  if (state.status === 'loading') return <LoadingState message="Loading event details…" />;
  if (state.status === 'error') {
    if (state.error instanceof ApiError && state.error.status === 404) return <EmptyState title="This event is unavailable">It may have been removed or the link may be incorrect. Return to Discover to find another event.</EmptyState>;
    return <ErrorState error={state.error} onRetry={retry} />;
  }
  return <EventInformation event={state.data.event} />;
}

export function EventDetail({ id, backHref }: { id?: string; backHref: string }) {
  return <section className="panel event-detail"><a className="text-link" href={backHref}>← Back to browsing</a>
    {id ? <LoadedDetail key={id} id={id} /> : <EmptyState title="Choose an event">Open an event in Discover to see its details.</EmptyState>}
  </section>;
}
