import { z } from 'zod';
import type { EventDraft, PublishedEvent } from './events';

// ---------- Records ----------

export type OrganizerSession = { organizationId: string; organizationName: string };

export type DraftRecord = {
  id: string;
  status: 'draft';
  draft: EventDraft;
  organizationName: string;
  flyerUrl: string | null; // GET-able image URL, e.g. /api/flyers/<id>
  extractedBy: 'model' | 'manual';
  createdAt: string;
  updatedAt: string;
};

// Events shown to students. `cancelled` events are only returned to their organizer.
export type EventRecord = Omit<PublishedEvent, 'status'> & {
  status: 'published' | 'cancelled';
  organizationName: string | null;
  flyerUrl: string | null;
  publishedAt: string;
};

// ---------- Requests ----------

export const loginRequestSchema = z.object({ accessCode: z.string().trim().min(1).max(200) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// POST /api/organizer/drafts. Send an image (base64, no data: prefix) and/or pasted text.
export const createDraftRequestSchema = z.object({
  imageBase64: z.string().max(8_000_000).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).optional(),
  text: z.string().max(10_000).optional(),
  sourceUrl: z.string().url().optional(),
}).refine(v => v.imageBase64 || v.text, { message: 'Provide a flyer image or announcement text.' })
  .refine(v => !v.imageBase64 || v.mimeType, { message: 'mimeType is required with an image.' });
export type CreateDraftRequest = z.infer<typeof createDraftRequestSchema>;

// PATCH /api/organizer/drafts/:id — any subset of draft fields. Null clears a field to unknown.
export type UpdateDraftRequest = Partial<EventDraft>;

// PATCH /api/organizer/events/:id — edit fields and/or cancel.
export type UpdateEventRequest = Partial<EventDraft> & { cancelled?: boolean };

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  // Optional ISO time for demos/tests; defaults to server time.
  now: z.string().datetime({ offset: true }).optional(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// ---------- Search ----------

// What the query was understood to mean. Application code applies these, not the model.
export const searchConstraintsSchema = z.object({
  keywords: z.array(z.string().max(60)).max(20),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  afterMinutes: z.number().int().min(0).max(1439).nullable(), // local time-of-day lower bound
  freeOnly: z.boolean(),
  foodAdvertisedOnly: z.boolean(),
  beginnerOnly: z.boolean(),
});
export type SearchConstraints = z.infer<typeof searchConstraintsSchema>;

export type SearchResult = { event: EventRecord; reason: string };
export type ExclusionNote = { reason: string; count: number };

export type SearchResponse = {
  answer: string;
  constraints: SearchConstraints;
  constraintSummary: string[]; // e.g. ["Fri Nov 14", "after 5:00 PM", "free only"]
  results: SearchResult[];
  excluded: ExclusionNote[];
  noMatch: boolean;
  interpretedBy: 'model' | 'rules';
};

// ---------- Responses ----------

export type HealthResponse = { status: 'ok'; mode: 'live' | 'memory'; modelConfigured: boolean };
export type EventsResponse = { events: EventRecord[]; mode: 'live' };
export type EventResponse = { event: EventRecord };
export type DraftResponse = { draft: DraftRecord };
export type DraftsResponse = { drafts: DraftRecord[] };
export type PublishErrorResponse = { error: string; missing: string[] };
export type ErrorResponse = { error: string };

// GET /api/events query params: from, to (ISO), free=1, food=1, q=keyword text
