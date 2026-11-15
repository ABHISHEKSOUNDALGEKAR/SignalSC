import type { EventResponse, EventsResponse } from '../../../shared/api';
import type { Filters } from './events';
import { eventsPath } from './events';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly missing: string[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions = Omit<RequestInit, 'body' | 'credentials'> & { json?: unknown };

/** Requests stay on the same origin, including organizer cookie sessions. */
export async function apiRequest<T>(path: `/api/${string}`, options: ApiOptions = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin',
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  // Organizer sign-out intentionally returns no body.
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try { body = await response.json(); }
  catch (error) {
    if (isAbortError(error)) throw error;
    if (response.ok) throw new ApiError(response.status, 'The service returned an unreadable response. Please try again.');
  }
  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    throw new ApiError(response.status,
      typeof record.error === 'string' ? record.error : 'The request could not be completed. Please try again.',
      Array.isArray(record.missing) ? record.missing.filter((field): field is string => typeof field === 'string') : [],
    );
  }
  return body as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Unable to connect. Check your connection and try again.';
}

export async function getEvents(signal: AbortSignal, filters?: Filters): Promise<EventsResponse> {
  const data = await apiRequest<EventsResponse>(filters ? eventsPath(filters) : '/api/events', { signal });
  if (!data || !Array.isArray(data.events)) {
    throw new ApiError(200, 'The event list could not be read. Please try again.');
  }
  return data;
}

export async function getEvent(id: string, signal: AbortSignal): Promise<EventResponse> {
  const data = await apiRequest<EventResponse>(`/api/events/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
  if (!data?.event || data.event.id !== id) throw new ApiError(200, 'The event details could not be read. Please try again.');
  return data;
}
