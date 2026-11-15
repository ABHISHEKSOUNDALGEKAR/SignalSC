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

export const feedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  wouldReturn: z.boolean().nullable(),
  comment: z.string().trim().max(1000),
  deviceKey: z.string().trim().min(8).max(64),
});
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ---------- Search ----------

// What the query was understood to mean. Application code applies these, not the model.
export const searchConstraintFields = z.object({
  keywords: z.array(z.string().max(60)).max(20),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  afterMinutes: z.number().int().min(0).max(1439).nullable(), // local time-of-day lower bound
  freeOnly: z.boolean(),
  foodAdvertisedOnly: z.boolean(),
  beginnerOnly: z.boolean(),
}).strict();
export const searchConstraintsSchema = searchConstraintFields.refine(c =>
  Date.parse(c.to) > Date.parse(c.from) && Date.parse(c.to) - Date.parse(c.from) <= 120 * 86_400_000,
{ message: 'Choose an end after the start, within 120 days.' });
export type SearchConstraints = z.infer<typeof searchConstraintsSchema>;

// Context is structured, client-held state, not a stored conversation.
export const searchRequestSchema = z.object({
  query: z.string().trim().max(500).default(''),
  context: searchConstraintsSchema.optional(),
  constraints: searchConstraintsSchema.optional(),
  now: z.string().datetime({ offset: true }).optional(),
}).strict().refine(v => !(v.context && v.constraints) && (v.constraints || v.query.length > 0),
  { message: 'Provide a question or edited filters, not both search modes.' });
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type SearchResult = { event: EventRecord; reason: string; differences?: string[] };
export type ExclusionNote = { reason: string; count: number };

export type SearchResponse = {
  answer: string;
  constraints: SearchConstraints;
  constraintSummary: string[]; // e.g. ["Fri Nov 14", "after 5:00 PM", "free only"]
  results: SearchResult[];
  relatedResults?: SearchResult[];
  excluded: ExclusionNote[];
  noMatch: boolean;
  interpretedBy: 'model' | 'rules';
  // Present when either AI stage was skipped or failed; answer also discloses it.
  fallbackReason?: 'capacity' | 'unavailable' | 'not_configured';
  // False means the refinement failed; constraints and matching remain unchanged.
  refinementApplied?: boolean;
};

// ---------- Responses ----------

export type HealthResponse = { status: 'ok'; mode: 'live' | 'memory'; modelConfigured: boolean };
export const importHealthOutcomes = [
  'recovered', 'cached', 'cached_unknown', 'provider_failure', 'invalid_response',
  'cooldown', 'busy', 'oversized', 'capacity', 'coordination_failure', 'not_configured', 'deferred',
] as const;
export type ImportHealthOutcome = typeof importHealthOutcomes[number];
export type ImportHealthRun = {
  source: 'engagesc' | 'usc-calendar';
  checkedAt: string;
  lastSuccessAt: string | null;
  eventCount: number;
  outcomes: {
    outcome: ImportHealthOutcome; count: number;
    retryEligible: number; nextRetryAt: string | null;
  }[];
};
export type ImportHealthResponse = { modelConfigured: boolean; runs: ImportHealthRun[] };
export type EventsResponse = { events: EventRecord[]; mode: 'live' };
export type EventResponse = { event: EventRecord };
export type DraftResponse = { draft: DraftRecord };
export type DraftsResponse = { drafts: DraftRecord[] };
export type PublishErrorResponse = { error: string; missing: string[] };
export type ErrorResponse = { error: string };

export type FeedbackResponse = { ok: true };
export type FeedbackSummaryAvailableResponse = { count: number };
export type FeedbackEntry = {
  rating: number;
  wouldReturn: boolean | null;
  comment: string;
  createdAt: string;
  demo: boolean;
};
export type FeedbackQuote = { point: string; quote: string };
export type FeedbackRequestSummary = FeedbackQuote & { count: number };
export type FeedbackRatingCounts = Record<'1' | '2' | '3' | '4' | '5', number>;
export type FeedbackSummary = {
  overall: string;
  wentWell: FeedbackQuote[];
  toImprove: FeedbackQuote[];
  requests: FeedbackRequestSummary[];
  averageRating: number;
  ratingCounts: FeedbackRatingCounts;
  wouldReturnYes: number;
  wouldReturnNo: number;
  wouldReturnUnknown: number;
  responseCount: number;
  note?: string;
};
export type StoredFeedbackSummary = {
  summary: FeedbackSummary;
  generatedAt: string;
  responseCount: number;
};
export type OrganizerFeedbackResponse = {
  responses: FeedbackEntry[];
  summary: StoredFeedbackSummary | null;
};

// GET /api/events: from/to (ISO), free=1, food=1, q=keywords.
// scope=all with q of at least 2 characters also searches past event titles.
