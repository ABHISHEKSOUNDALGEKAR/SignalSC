import React from 'react';
import type { EventRecord } from '../../../shared/api';
import { eventHref } from '../lib/navigation';
import { FieldDisplay } from './States';
import { confirmationLabel, costLabel, dateLabel, foodLabel } from '../lib/events';

export function EventCard({ event }: { event: EventRecord }) {
  return <article className="event-card"><span className="badge">{confirmationLabel(event)}</span>
    <h4><a href={eventHref(event.id)}>{event.title}</a></h4>
    <p className="event-description">{event.description || 'Unknown'}</p>
    <dl className="facts"><FieldDisplay label="Starts" value={dateLabel(event.startsAt)} /><FieldDisplay label="Location" value={event.location} />
      <FieldDisplay label="Admission" value={costLabel(event.costCents)} /><FieldDisplay label="Food" value={foodLabel(event.food)} />
    </dl><a className="text-link" href={eventHref(event.id)} aria-label={`View details: ${event.title}`}>View details →</a>
  </article>;
}
