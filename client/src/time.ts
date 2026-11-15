const zone = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function campusInput(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  const parts = zone.formatToParts(new Date(value));
  const p = (key: string) => parts.find(item => item.type === key)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
export function campusInstant(value: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, minute] = match.map(Number);
  const target = Date.UTC(y, m - 1, d, h, minute);
  let result = target;
  for (let i = 0; i < 2; i++) {
    const parts = zone.formatToParts(new Date(result));
    const p = (key: string) => Number(parts.find(item => item.type === key)!.value);
    const represented = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
    result += target - represented;
  }
  const iso = new Date(result).toISOString();
  // Reject nonexistent local times during the spring-forward gap instead of shifting an event.
  if (campusInput(iso) !== value) throw new Error('This Los Angeles time does not exist due to daylight saving time. Choose another time.');
  return iso;
}
export function campusRange(period: 'today' | 'week', now = new Date()): string {
  const date = campusInput(now.toISOString()).slice(0, 10);
  const localDate = new Date(`${date}T00:00:00Z`);
  const end = new Date(localDate);
  const days = period === 'today' ? 1 : ((8 - localDate.getUTCDay()) % 7) || 7;
  end.setUTCDate(end.getUTCDate() + days);
  const from = period === 'today' ? campusInstant(`${date}T00:00`)! : now.toISOString();
  const to = campusInstant(`${end.toISOString().slice(0, 10)}T00:00`)!;
  return new URLSearchParams({ from, to }).toString();
}
