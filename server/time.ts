// All campus times are interpreted in America/Los_Angeles.
export const CAMPUS_TZ = 'America/Los_Angeles';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(date: Date): LocalParts {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

// Offset (minutes) of campus time from UTC at the given instant, e.g. -480 in winter.
function offsetMinutes(date: Date): number {
  const p = localParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// Campus wall-clock time → instant. Handles daylight saving transitions.
export function campusTimeToDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  result = new Date(guess - offsetMinutes(result) * 60000);
  return result;
}

// ISO string with the campus offset, e.g. 2026-11-18T18:00:00-08:00
export function toCampusIso(date: Date): string {
  const p = localParts(date);
  const off = offsetMinutes(date);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function startOfCampusDay(date: Date, addDays = 0): Date {
  const p = localParts(date);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return campusTimeToDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function formatCampusDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CAMPUS_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

export function formatCampusTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CAMPUS_TZ, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}
