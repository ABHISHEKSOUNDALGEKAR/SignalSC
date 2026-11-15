import React from 'react';
import { EmptyState } from '../components/States';

export function PlannedScreen() {
  return <section className="panel"><span className="badge">Coming next</span><EmptyState title="A place for your next plans">Saving events on this device is planned for Step 5. No events are being saved yet.</EmptyState></section>;
}
