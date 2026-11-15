// iCalendar export (RFC 5545) and a small parser for importing public feeds.

function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Fold lines longer than 75 octets.
function fold(line: string) {
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > 74) { out.push(current); current = ' ' + ch; } else current += ch;
  }
  out.push(current);
  return out.join('\r\n');
}

function utcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export type CalendarEventInput = {
  id: string; title: string; description: string; startsAt: string; endsAt: string | null;
  location: string | null; url: string | null; cancelled: boolean; updatedAt: string;
};

export function buildIcs(e: CalendarEventInput, host: string) {
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trojan Signal//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@${host}`,
    `DTSTAMP:${utcStamp(new Date(e.updatedAt))}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- Parsing ----------

export type ParsedIcsEvent = {
  uid: string; summary: string; description: string; location: string | null; url: string | null;
  start: Date | null; end: Date | null; allDay: boolean; status: string | null;
};

function unescapeText(value: string) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseIcsDate(value: string, tzToDate: (y: number, m: number, d: number, h: number, mi: number) => Date): { date: Date; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { date: tzToDate(+y, +mo, +d, 0, 0), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), allDay: false };
  // Floating or TZID times: USC feeds use America/Los_Angeles.
  return { date: tzToDate(+y, +mo, +d, +h, +mi), allDay: false };
}

export function parseIcs(text: string, tzToDate: (y: number, m: number, d: number, h: number, mi: number) => Date): ParsedIcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, { value: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const start = current.DTSTART ? parseIcsDate(current.DTSTART.value, tzToDate) : null;
        const end = current.DTEND ? parseIcsDate(current.DTEND.value, tzToDate) : null;
        events.push({
          uid: current.UID?.value ?? '',
          summary: unescapeText(current.SUMMARY?.value ?? ''),
          description: unescapeText(current.DESCRIPTION?.value ?? ''),
          location: current.LOCATION ? unescapeText(current.LOCATION.value) || null : null,
          url: current.URL?.value || null,
          start: start?.date ?? null,
          end: end?.date ?? null,
          allDay: start?.allDay ?? false,
          status: current.STATUS?.value ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0];
    const key = name.toUpperCase();
    if (!(key in current)) current[key] = { value: line.slice(colon + 1) };
  }
  return events;
}
