import type { DraftResponse, DraftsResponse, EventResponse, EventsResponse, OrganizerSession, UpdateDraftRequest } from '../../../shared/api';
import { apiRequest, ApiError } from './api';

export const sessionPath = '/api/organizer/session' as const;
export const readSession = (signal: AbortSignal) => apiRequest<OrganizerSession>(sessionPath, { signal, cache: 'no-store' });
export async function requireSessionForOrganization(organizationId: string, signal: AbortSignal, onExpired: () => void) {
  try {
    const session = await readSession(signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (session.organizationId !== organizationId) { onExpired(); throw new DOMException('Organization changed', 'AbortError'); }
  } catch (cause) {
    if (!signal.aborted && cause instanceof ApiError && cause.status === 401) onExpired();
    throw cause;
  }
}
export async function organizerLists(signal: AbortSignal) {
  const [drafts, events] = await Promise.all([
    apiRequest<DraftsResponse>('/api/organizer/drafts', { signal, cache: 'no-store' }),
    apiRequest<EventsResponse>('/api/organizer/events', { signal, cache: 'no-store' }),
  ]);
  return { drafts: drafts.drafts, events: events.events };
}
/** Publishing must never race ahead of the successful correction PATCH. */
export async function saveDraft(id: string, patch: UpdateDraftRequest, publish: boolean, signal: AbortSignal) {
  const path = `/api/organizer/drafts/${encodeURIComponent(id)}` as const;
  const saved = await apiRequest<DraftResponse>(path, { method: 'PATCH', json: patch, signal });
  if (!publish) return saved;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return apiRequest<EventResponse>(`${path}/publish`, { method: 'POST', signal });
}

/** Ignore this tab's own broadcast, but accept other tabs and the older message shape. */
export function sessionChangedElsewhere(message: unknown, sender: string): boolean {
  if (message === 'changed') return true;
  if (!message || typeof message !== 'object') return false;
  const data = message as { type?: unknown; source?: unknown };
  return data.type === 'changed' && typeof data.source === 'string' && data.source !== sender;
}
