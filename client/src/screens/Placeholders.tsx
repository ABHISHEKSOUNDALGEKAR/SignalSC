import React from 'react';
import { EmptyState } from '../components/States';
import type { Route } from '../lib/navigation';

export function PlannedScreen({ page }: { page: 'ask' | 'saved' | 'organizer' }) {
  const content = {
    ask: { title: 'A question away from your next plan', body: 'Question search and starter prompts are planned for Step 4.' },
    saved: { title: 'A place for your next plans', body: 'Saving events on this device is planned for Step 5. No events are being saved yet.' },
    organizer: { title: 'Flyer → review → publish', body: 'Organizer sign-in, flyer upload, and the review form are planned for Step 3.' },
  }[page];
  return <section className="panel"><span className="badge">Coming next</span><EmptyState title={content.title}>{content.body}</EmptyState></section>;
}

export function EventDetailShell({ route, backHref }: { route: Extract<Route, { page: 'event' }>; backHref: string }) {
  return <section className="panel"><a className="text-link" href={backHref}>← Back to browsing</a>
    <EmptyState title="Event detail layout">Full event details and actions are planned for Step 2. {route.id ? 'This event has not been loaded.' : 'This is a layout preview; no event is selected.'}</EmptyState>
  </section>;
}
