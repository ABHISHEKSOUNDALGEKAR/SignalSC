import React from 'react';
import type { EventRecord } from '../../../shared/api';
import { eventHref } from '../lib/navigation';
import { FieldDisplay } from './States';

// Basic reusable card; grouping, filters and full details belong to Step 2.
export function EventCard({ event }: { event: EventRecord }) {
  return <article className="event-card"><h3><a href={eventHref(event.id)}>{event.title}</a></h3>
    <p>{event.description}</p><dl><FieldDisplay label="Location" value={event.location} /></dl>
  </article>;
}
