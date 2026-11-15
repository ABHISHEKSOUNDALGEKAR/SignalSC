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
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SignalSC//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
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
  organizer: string | null; // ORGANIZER;CN=...
  categories: { kind: string | null; value: string }[]; // kind comes from X-CG-CATEGORY when present
};

export type TzToDate = (y: number, m: number, d: number, h: number, mi: number) => Date;

function unescapeText(value: string) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseIcsDate(value: string, tzToDate: TzToDate): { date: Date; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { date: tzToDate(+y, +mo, +d, 0, 0), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), allDay: false };
  // Floating or TZID times: USC feeds use America/Los_Angeles.
  return { date: tzToDate(+y, +mo, +d, +h, +mi), allDay: false };
}

type Property = { name: string; params: string; value: string };

// Split "NAME;PARAM=x:value" at the first colon that is not inside a quoted parameter value.
function splitProperty(line: string): Property | null {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      const head = line.slice(0, i);
      const semi = head.indexOf(';');
      return {
        name: (semi < 0 ? head : head.slice(0, semi)).toUpperCase(),
        params: semi < 0 ? '' : head.slice(semi + 1),
        value: line.slice(i + 1),
      };
    }
  }
  return null;
}

function param(params: string, key: string): string | null {
  const m = params.match(new RegExp(`(?:^|;)${key}=(?:"([^"]*)"|([^;]*))`, 'i'));
  return m ? (m[1] ?? m[2] ?? '').trim() || null : null;
}

export function parseIcs(text: string, tzToDate: TzToDate): ParsedIcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = []; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const props = current;
        const first = (name: string) => props.find(p => p.name === name) ?? null;
        const dtStart = first('DTSTART'), dtEnd = first('DTEND'), organizer = first('ORGANIZER');
        const start = dtStart ? parseIcsDate(dtStart.value.trim(), tzToDate) : null;
        const end = dtEnd ? parseIcsDate(dtEnd.value.trim(), tzToDate) : null;
        events.push({
          uid: first('UID')?.value.trim() ?? '',
          summary: unescapeText(first('SUMMARY')?.value ?? '').trim(),
          description: unescapeText(first('DESCRIPTION')?.value ?? ''),
          location: unescapeText(first('LOCATION')?.value ?? '').trim() || null,
          url: first('URL')?.value.trim() || null,
          start: start?.date ?? null,
          end: end?.date ?? null,
          allDay: start?.allDay ?? false,
          status: first('STATUS')?.value.trim().toUpperCase() ?? null,
          organizer: organizer ? param(organizer.params, 'CN') : null,
          categories: props.filter(p => p.name === 'CATEGORIES')
            .map(p => ({ kind: param(p.params, 'X-CG-CATEGORY'), value: unescapeText(p.value).trim() }))
            .filter(c => c.value),
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const property = splitProperty(line);
    if (property) current.push(property);
  }
  return events;
}
