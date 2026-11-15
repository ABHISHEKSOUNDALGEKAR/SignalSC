import React from 'react';
import { EmptyState } from '../components/States';

export function PlannedScreen({ page }: { page: 'ask' | 'saved' }) {
  const content = {
    ask: { title: 'A question away from your next plan', body: 'Question search and starter prompts are planned for Step 4.' },
    saved: { title: 'A place for your next plans', body: 'Saving events on this device is planned for Step 5. No events are being saved yet.' },
  }[page];
  return <section className="panel"><span className="badge">Coming next</span><EmptyState title={content.title}>{content.body}</EmptyState></section>;
}
