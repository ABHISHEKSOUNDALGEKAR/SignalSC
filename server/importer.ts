// Imports public events from an iCalendar feed (EngageSC school-wide feed or calendar.usc.edu).
// Imported records are labeled source-imported and are never shown as organizer-confirmed.
import type { EventDraft } from '../shared/events';
import { parseIcs, type ParsedIcsEvent } from './ics';
import { newId } from './records';
import type { Store, StoredEvent } from './store';
import { campusTimeToDate, toCampusIso } from './time';

export const DEFAULT_FEED_URL = 'https://engage.usc.edu/ical/usc/ical_usc.ics';
const REFRESH_MS = 60 * 60 * 1000; // the feed publishes a one-hour TTL
const META_KEY = 'feed-imported-at';

// The public feed hides most locations behind USC sign-in.
const UNKNOWN_LOCATION = /^(sign in to download the location|tbd|tba|n\/a|none)$/i;
// Only explicit offers count as "food advertised"; anything else stays unknown.
const FOOD_PATTERN = /\b(free food|food (?:and|&) drinks?|food (?:will be |is )?(?:provided|served)|refreshments|snacks|pizza|boba|potluck|catered|catering|donuts|tacos|light bites|delicious food|(?:lunch|dinner|breakfast|brunch) (?:will be |is )?(?:provided|served|included)|free (?:lunch|dinner|breakfast|brunch))\b/i;
const MEAL_EVENT_TYPE = /^(luncheon|dinner \/ gala)$/i;
const FREE_ADMISSION_PATTERN = /\b(free (?:admission|entry|event|to attend|and open to)|admission is free|no cost|free of charge)\b/i;

function cleanDescription(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\n?\s*-{3}\s*\nEvent Details:\s*\S+\s*$/i, '') // feed appends a link back to the event page
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function excerpt(text: string, index: number, length: number) {
  const start = Math.max(0, index - 60);
  return text.slice(start, Math.min(text.length, index + length + 60)).replace(/\s+/g, ' ').trim().slice(0, 300);
}

function safeUrl(value: string | null) {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}

export type MappedFeedEvent = { draft: EventDraft; organizationName: string | null; externalId: string };

// Returns null for events that should not be listed (past, all-day, cancelled, or incomplete).
export function mapFeedEvent(e: ParsedIcsEvent, sourceKind: EventDraft['sourceKind'], now: Date): MappedFeedEvent | null {
  const end = e.end ?? e.start;
  if (!e.uid || !e.summary || !e.start || !end || e.allDay || end.getTime() < now.getTime() || e.status === 'CANCELLED') return null;

  const body = cleanDescription(e.description);
  const eventType = e.categories.find(c => c.kind === 'event_type')?.value ?? null;
  const tags = e.categories.filter(c => c.kind === 'event_tags').flatMap(c => c.value.split(','))
    .map(t => t.trim()).filter(t => t && !/^none$/i.test(t));
  const labels = [eventType ? `Event type: ${eventType}.` : '', tags.length ? `Tags: ${tags.join(', ')}.` : ''].filter(Boolean).join(' ');
  const description = [body, labels].filter(Boolean).join('\n\n').slice(0, 5000);

  const evidence: EventDraft['evidence'] = [];
  const uncertainties: string[] = [];
  const text = `${e.summary}\n${body}`;

  let food: EventDraft['food'] = 'unknown';
  const foodMatch = FOOD_PATTERN.exec(text);
  if (foodMatch) { food = 'advertised'; evidence.push({ field: 'food', excerpt: excerpt(text, foodMatch.index, foodMatch[0].length) }); }
  else if (eventType && MEAL_EVENT_TYPE.test(eventType)) { food = 'advertised'; evidence.push({ field: 'food', excerpt: `Event type: ${eventType}` }); }

  let costCents: number | null = null;
  const freeMatch = FREE_ADMISSION_PATTERN.exec(text);
  if (freeMatch) { costCents = 0; evidence.push({ field: 'costCents', excerpt: excerpt(text, freeMatch.index, freeMatch[0].length) }); }

  let location = e.location;
  if (location && UNKNOWN_LOCATION.test(location)) {
    if (/sign in/i.test(location)) uncertainties.push('Location is shown on EngageSC after USC sign-in.');
    location = null;
  }

  const draft: EventDraft = {
    title: e.summary.slice(0, 200),
    description,
    startsAt: toCampusIso(e.start),
    endsAt: e.end && e.end > e.start ? toCampusIso(e.end) : null,
    timezone: 'America/Los_Angeles',
    location: location?.slice(0, 500) ?? null,
    eligibility: null,
    costCents,
    food,
    beginnerFriendly: null,
    registrationUrl: null,
    registrationDeadline: null,
    sourceUrl: safeUrl(e.url),
    sourceKind,
    evidence,
    uncertainties,
  };
  return { draft, organizationName: e.organizer?.slice(0, 200) ?? null, externalId: `${sourceKind}:${e.uid}` };
}

export type ImportResult = { inserted: number; updated: number; unchanged: number; skipped: number };

export async function importFeed(store: Store, url: string, now = new Date()): Promise<ImportResult> {
  const sourceKind: EventDraft['sourceKind'] = /calendar\.usc\.edu/.test(url) ? 'usc-calendar' : 'engagesc';
  const response = await fetch(url, { headers: { Accept: 'text/calendar', 'User-Agent': 'SignalSC/0.1 (student project)' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
  const parsed = parseIcs(await response.text(), campusTimeToDate);
  const result: ImportResult = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  const stamp = now.toISOString();
  for (const e of parsed) {
    const mapped = mapFeedEvent(e, sourceKind, now);
    if (!mapped) { result.skipped++; continue; }
    const record: StoredEvent = {
      id: newId(), status: 'published', organizationId: null, organizationName: mapped.organizationName, data: mapped.draft,
      flyerId: null, extractedBy: 'import', confirmation: 'source-imported', externalId: mapped.externalId,
      createdAt: stamp, updatedAt: stamp, publishedAt: stamp,
    };
    result[await store.upsertImported(record)]++;
  }
  return result;
}

// Refreshes the feed on start and hourly while the server is awake. The timestamp is stored
// so several instances (or quick restarts) do not all fetch the feed.
export function scheduleFeedImport(store: Store, url: string) {
  const run = async () => {
    try {
      const last = await store.getMeta(META_KEY);
      if (last && Date.now() - Date.parse(last) < REFRESH_MS) return;
      await store.setMeta(META_KEY, new Date().toISOString());
      try {
        const r = await importFeed(store, url);
        console.log(`Feed import: ${r.inserted} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.skipped} skipped.`);
      } catch (error) {
        await store.setMeta(META_KEY, new Date(0).toISOString()); // retry on the next cycle
        throw error;
      }
    } catch (error) {
      console.warn('Feed import failed:', error instanceof Error ? error.message : error);
    }
  };
  void run();
  setInterval(run, REFRESH_MS).unref();
}
