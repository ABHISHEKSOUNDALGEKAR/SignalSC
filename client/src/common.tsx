import type { ReactNode } from 'react';
import type { EventRecord } from './api';

export function dateLabel(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).format(date);
}
export function dayLabel(value: string | null): string {
  if (!value) return 'Time to be announced';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date(value));
}
export function money(cents: number | null): string {
  if (cents === null) return 'Unknown';
  return cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
export function unknown(value: string | null | undefined): string {
  return value?.trim() || 'Unknown';
}
export function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error-box" role="alert"><strong>We couldn’t load that just now.</strong><p>{error}</p>{retry && <button className="btn btn-outline" onClick={retry}>Try again</button>}</div>;
}
export function LoadingList({ count = 3 }: { count?: number }) {
  return <div className="event-list" aria-label="Loading events">{Array.from({ length: count }, (_, i) => <div key={i} className="loading-card" />)}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark">✦</div><h3>{title}</h3>{children && <p className="muted">{children}</p>}{action}</div>;
}
export function EventCard({ event, href, reason }: { event: EventRecord; href: string; reason?: string }) {
  return <a className="event-card" href={href}>
    <div className="event-card-top"><div><h3 className="event-title">{event.title}</h3><div className="event-meta">{dateLabel(event.startsAt)}<br />{unknown(event.location)} · {money(event.costCents)}</div></div>
      <span className={`badge ${event.status === 'cancelled' ? 'cancelled' : ''}`}>{event.status === 'cancelled' ? 'Cancelled' : event.food === 'advertised' ? 'Food advertised' : 'Campus event'}</span>
    </div>
    {reason && <div className="event-reason"><strong>Why it fits</strong> · {reason}</div>}
  </a>;
}
export function dateGroups(events: EventRecord[]): Array<[string, EventRecord[]]> {
  const groups = new Map<string, EventRecord[]>();
  for (const event of events) {
    const key = dayLabel(event.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()];
}
export function Confirmation({ event }: { event: EventRecord }) {
  return <span className={`badge ${event.confirmation === 'organizer-confirmed' ? 'confirmed' : ''}`}>
    {event.confirmation === 'organizer-confirmed' ? 'Organizer confirmed' : event.sourceKind === 'usc-calendar' ? 'Imported from USC Calendar' : 'Imported from EngageSC'}
  </span>;
}
