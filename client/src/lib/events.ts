import type { EventRecord } from '../../../shared/api';

export const campusTimezone = 'America/Los_Angeles';
const parts = new Intl.DateTimeFormat('en-US', { timeZone: campusTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function localParts(date: Date) {
  const values = Object.fromEntries(parts.formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

/** Calendar-day arithmetic, not elapsed 24-hour arithmetic (DST days differ). */
export function campusDayStart(date: Date, addDays = 0): Date {
  const p = localParts(date);
  const target = Date.UTC(p.year, p.month - 1, p.day + addDays);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const local = localParts(new Date(instant));
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instant;
    instant = target - offset;
  }
  return new Date(instant);
}

export type Filters = { date: 'all' | 'today' | 'week'; free: boolean; food: boolean };
export const initialFilters: Filters = { date: 'all', free: false, food: false };
export function eventsPath(filters: Filters, now = new Date()): `/api/${string}` {
  const query = new URLSearchParams();
  // Only upcoming or ongoing events, even when a date filter is selected.
  query.set('from', now.toISOString());
  if (filters.date !== 'all') {
    const p = localParts(now);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const daysToMonday = weekday === 0 ? 1 : 8 - weekday;
    query.set('to', campusDayStart(now, filters.date === 'today' ? 1 : daysToMonday).toISOString());
  }
  if (filters.free) query.set('free', '1');
  if (filters.food) query.set('food', '1');
  return `/api/events?${query}`;
}

export function dateLabel(value: string | null, withTime = true): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { timeZone: campusTimezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } as const : {}),
  }).format(new Date(value));
}

export function groupEvents(events: EventRecord[]) {
  const groups = new Map<string, { label: string; events: EventRecord[] }>();
  const sorted = [...events].sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity));
  for (const event of sorted) {
    const p = event.startsAt && Number.isFinite(Date.parse(event.startsAt)) ? localParts(new Date(event.startsAt)) : null;
    const key = p ? `${p.year}-${p.month}-${p.day}` : 'unknown';
    if (!groups.has(key)) groups.set(key, { label: dateLabel(event.startsAt, false), events: [] });
    groups.get(key)!.events.push(event);
  }
  return [...groups.entries()];
}

export const costLabel = (cents: number | null) => cents === null ? 'Unknown' : cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const foodLabel = (food: EventRecord['food']) => ({ advertised: 'Advertised', 'not-advertised': 'Not advertised', unknown: 'Unknown' })[food];
export const sourceLabel = (kind: EventRecord['sourceKind']) => ({ flyer: 'Flyer', engagesc: 'EngageSC', 'usc-calendar': 'USC calendar' })[kind];
export const confirmationLabel = (event: EventRecord) => event.confirmation === 'organizer-confirmed' ? 'Organizer-confirmed' : `Imported from ${sourceLabel(event.sourceKind)}`;

export function webUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value : undefined; }
  catch { return undefined; }
}
