import React from 'react';
import type { EventRecord } from '../../../shared/api';
import { eventHref } from '../lib/navigation';
import { FieldDisplay } from './States';
import { confirmationLabel, costLabel, dateLabel, foodLabel } from '../lib/events';
import { SaveButton } from './SavedEvents';

export function EventCard({ event, headingLevel = 4 }: { event: EventRecord; headingLevel?: 3 | 4 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return <article className="event-card"><span className="badge">{confirmationLabel(event)}</span>
    <Heading className="card-title"><a href={eventHref(event.id)}>{event.title}</a></Heading>
    {event.status === 'cancelled' && <p className="cancelled" role="status">Cancelled — check the original source for updates.</p>}
    <p className="event-description">{event.description || 'Unknown'}</p>
    <dl className="facts"><FieldDisplay label="Starts" value={dateLabel(event.startsAt)} /><FieldDisplay label="Location" value={event.location} />
      <FieldDisplay label="Admission" value={costLabel(event.costCents)} /><FieldDisplay label="Food" value={foodLabel(event.food)} />
    </dl><div className="card-actions"><a className="text-link" href={eventHref(event.id)} aria-label={`View details: ${event.title}`}>View details →</a><SaveButton id={event.id} title={event.title} /></div>
  </article>;
}
