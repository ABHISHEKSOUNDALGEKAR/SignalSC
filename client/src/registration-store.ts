import { z } from 'zod';
import { readBrowserValue } from './storage';

export const REGISTRATION_CHANGE = 'signalsc-registration-change';
export const REGISTRATION_KEY = 'signalsc-registration-state';
const pendingSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().max(200),
  owner: z.string(), createdAt: z.number(), left: z.boolean(), deferredUntil: z.number(),
});
const stateSchema = z.object({
  registered: z.array(z.string().min(1).max(200)).max(5000),
  pending: z.array(pendingSchema).max(10),
});
export type PendingRegistration = z.infer<typeof pendingSchema>;
type RegistrationState = z.infer<typeof stateSchema>;
let fallbackTabId: string | undefined;

export function registrationTabId(): string {
  if (!fallbackTabId) {
    try {
      fallbackTabId = sessionStorage.getItem('signalsc-registration-tab') ?? crypto.randomUUID();
      sessionStorage.setItem('signalsc-registration-tab', fallbackTabId);
    } catch { fallbackTabId = crypto.randomUUID(); }
  }
  return fallbackTabId;
}

export function readRegistrations(): RegistrationState {
  const raw = localStorage.getItem(REGISTRATION_KEY);
  if (!raw) return { registered: [], pending: [] };
  const result = stateSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error('Registration data could not be read. Please check browser storage.');
  return result.data;
}

export function readSavedIds(): string[] {
  const raw = readBrowserValue('saved');
  return raw === null ? [] : z.array(z.string()).parse(JSON.parse(raw));
}

function write(state: RegistrationState) {
  localStorage.setItem(REGISTRATION_KEY, JSON.stringify(state));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REGISTRATION_CHANGE));
}

export function startRegistrationCheck(event: { id: string; title: string }, owner = registrationTabId(), now = Date.now()) {
  const state = readRegistrations();
  if (state.registered.includes(event.id)) return;
  state.pending = state.pending.filter(item => item.id !== event.id && now - item.createdAt < 7 * 86_400_000);
  state.pending.push({ id: event.id, title: event.title.slice(0, 200), owner, createdAt: now, left: false, deferredUntil: 0 });
  state.pending = state.pending.slice(-10);
  write(state);
}

export function markRegistrationDeparture(owner = registrationTabId()) {
  const state = readRegistrations();
  let changed = false;
  for (const item of state.pending) {
    if (item.owner === owner && !item.left) { item.left = true; changed = true; }
  }
  if (changed) write(state);
}

export function nextRegistrationCheck(now = Date.now(), dismissed: Set<string> = new Set()): PendingRegistration | null {
  const state = readRegistrations();
  return state.pending.find(item => item.left && item.deferredUntil <= now
    && now - item.createdAt < 7 * 86_400_000 && !state.registered.includes(item.id) && !dismissed.has(item.id)) ?? null;
}

export function answerRegistration(id: string, answer: 'yes' | 'no' | 'later', now = Date.now()) {
  const state = readRegistrations();
  if (answer === 'yes') state.registered = [...new Set([...state.registered, id])];
  if (answer === 'later') {
    state.pending = state.pending.map(item => item.id === id ? { ...item, deferredUntil: now + 3_600_000 } : item);
  } else state.pending = state.pending.filter(item => item.id !== id);
  write(state);
}

export function moveRegistrationToSaved(id: string) {
  const state = readRegistrations();
  const parsed = readSavedIds();
  // Save first, so a failed second write can never lose the event.
  localStorage.setItem('signalsc-saved', JSON.stringify([...new Set([...parsed, id])]));
  state.registered = state.registered.filter(item => item !== id);
  state.pending = state.pending.filter(item => item.id !== id);
  write(state);
}
