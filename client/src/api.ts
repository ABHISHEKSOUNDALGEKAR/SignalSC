import type {
  DraftRecord, DraftResponse, DraftsResponse, EventRecord, EventResponse, EventsResponse,
  ExclusionNote, ImportHealthResponse, OrganizerFeedbackResponse, OrganizerSession, PublishErrorResponse, SearchResponse, SearchRequest, StoredFeedbackSummary,
} from '../../shared/api';
import type { EventDraft } from '../../shared/events';

export class ApiError extends Error {
  status: number;
  missing: string[];
  constructor(message: string, status: number, missing: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.missing = missing;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const missing = Array.isArray(data.missing) ? data.missing.filter((v): v is string => typeof v === 'string') : [];
    throw new ApiError(typeof data.error === 'string' ? data.error : `The request failed (${response.status}).`, response.status, missing);
  }
  return data as T;
}

export const api = {
  events: (query = '') => request<EventsResponse>(`/api/events${query ? `?${query}` : ''}`),
  event: (id: string) => request<EventResponse>(`/api/events/${encodeURIComponent(id)}`),
  search: (query: string, options: Pick<SearchRequest, 'context' | 'constraints'> = {}) =>
    request<SearchResponse>('/api/search', { method: 'POST', body: JSON.stringify({ query, ...options }) }),
  session: () => request<OrganizerSession>('/api/organizer/session'),
  importHealth: () => request<ImportHealthResponse>('/api/organizer/import-health', { cache: 'no-store' }),
  signIn: (accessCode: string) => request<OrganizerSession>('/api/organizer/session', { method: 'POST', body: JSON.stringify({ accessCode }) }),
  signOut: () => request<void>('/api/organizer/session', { method: 'DELETE' }),
  drafts: () => request<DraftsResponse>('/api/organizer/drafts'),
  createDraft: (body: { imageBase64?: string; mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; text?: string; sourceUrl?: string }) =>
    request<DraftResponse>('/api/organizer/drafts', { method: 'POST', body: JSON.stringify(body) }),
  updateDraft: (id: string, draft: Partial<EventDraft>) =>
    request<DraftResponse>(`/api/organizer/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(draft) }),
  publish: (id: string) => request<EventResponse>(`/api/organizer/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
  ownEvents: () => request<EventsResponse>('/api/organizer/events'),
  updateEvent: (id: string, update: Partial<EventDraft> & { cancelled?: boolean }) =>
    request<EventResponse>(`/api/organizer/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }),
  feedbackCount: (id: string) =>
    request<{ count: number }>(`/api/events/${encodeURIComponent(id)}/feedback/summary-available`),
  submitFeedback: (id: string, input: { rating: number; wouldReturn: boolean | null; comment: string; deviceKey: string }) =>
    request<{ ok: true }>(`/api/events/${encodeURIComponent(id)}/feedback`, { method: 'POST', body: JSON.stringify(input) }),
  organizerFeedback: (id: string) =>
    request<OrganizerFeedbackResponse>(`/api/organizer/events/${encodeURIComponent(id)}/feedback`),
  summarizeFeedback: (id: string) =>
    request<StoredFeedbackSummary>(`/api/organizer/events/${encodeURIComponent(id)}/feedback/summary`, { method: 'POST' }),
};

export type { DraftRecord, EventRecord, ExclusionNote, PublishErrorResponse, SearchResponse };
