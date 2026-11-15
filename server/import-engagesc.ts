// Imports public events from an iCalendar feed (EngageSC school-wide feed or calendar.usc.edu).
// Usage: npm run import:engagesc -- <feed-url>   (or set ENGAGESC_ICS_URL)
// Records are labeled source-imported and are never shown as organizer-confirmed.
import type { EventDraft } from '../shared/events';
import { parseIcs } from './ics';
import { newId } from './records';
import { createStore, type StoredEvent } from './store';
import { campusTimeToDate, toCampusIso } from './time';

const FOOD_PATTERN = /\b(free food|food (?:will be )?(?:provided|served)|refreshments|snacks|pizza|lunch (?:will be )?provided|dinner (?:will be )?provided|light bites|boba)\b/i;
const FREE_ADMISSION_PATTERN = /\b(free (?:admission|entry|event|to attend|and open)|no cost|free of charge)\b/i;

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function safeUrl(value: string | null) {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}

async function main() {
  const url = process.argv[2] ?? process.env.ENGAGESC_ICS_URL;
  if (!url) throw new Error('Pass the feed URL: npm run import:engagesc -- <feed-url>');
  const sourceKind: EventDraft['sourceKind'] = /calendar\.usc\.edu/.test(url) ? 'usc-calendar' : 'engagesc';
  const response = await fetch(url, { headers: { Accept: 'text/calendar' } });
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
  const parsed = parseIcs(await response.text(), campusTimeToDate);
  const now = Date.now();
  const store = createStore();
  await store.init();

  let inserted = 0, updated = 0, skipped = 0;
  for (const e of parsed) {
    const end = e.end ?? e.start;
    if (!e.uid || !e.summary || !e.start || e.allDay || (end && end.getTime() < now) || e.status === 'CANCELLED') { skipped++; continue; }
    const description = stripHtml(e.description).slice(0, 5000);
    const text = `${e.summary} ${description}`;
    const sourceUrl = safeUrl(e.url);
    const draft: EventDraft = {
      title: e.summary.slice(0, 200),
      description,
      startsAt: toCampusIso(e.start),
      endsAt: e.end && e.end > e.start ? toCampusIso(e.end) : null,
      timezone: 'America/Los_Angeles',
      location: e.location?.slice(0, 500) ?? null,
      eligibility: null,
      costCents: FREE_ADMISSION_PATTERN.test(text) ? 0 : null,
      food: FOOD_PATTERN.test(text) ? 'advertised' : 'unknown',
      beginnerFriendly: null,
      registrationUrl: null,
      registrationDeadline: null,
      sourceUrl,
      sourceKind,
      evidence: [],
      uncertainties: [],
    };
    const t = new Date().toISOString();
    const record: StoredEvent = {
      id: newId(), status: 'published', organizationId: null, organizationName: null, data: draft, flyerId: null,
      extractedBy: 'import', confirmation: 'source-imported', externalId: `${sourceKind}:${e.uid}`,
      createdAt: t, updatedAt: t, publishedAt: t,
    };
    (await store.upsertImported(record)) === 'inserted' ? inserted++ : updated++;
  }
  console.log(`Imported ${inserted} new, refreshed ${updated}, skipped ${skipped} (past, all-day, cancelled or incomplete).`);
  process.exit(0);
}

main().catch(error => { console.error(error.message); process.exit(1); });
