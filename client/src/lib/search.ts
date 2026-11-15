import { z } from 'zod';
import { searchConstraintsSchema, searchRequestSchema, type SearchResponse } from '../../../shared/api';
import { eventDraftSchema } from '../../../shared/events';
import { apiRequest, ApiError } from './api';
import { startResource } from './resource';

export const starterPrompts = ["What's happening tonight?", 'Free events this week', 'Events with food tomorrow', 'Events for beginners this week'] as const;

const eventSchema = eventDraftSchema.extend({
  id: z.string().min(1), status: z.enum(['published', 'cancelled']),
  confirmation: z.enum(['organizer-confirmed', 'source-imported']),
  organizationName: z.string().nullable(), flyerUrl: z.string().nullable(),
  publishedAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
});
const responseSchema = z.object({
  answer: z.string(), constraints: searchConstraintsSchema, constraintSummary: z.array(z.string()),
  results: z.array(z.object({ event: eventSchema, reason: z.string() })),
  excluded: z.array(z.object({ reason: z.string(), count: z.number().int().nonnegative() })),
  noMatch: z.boolean(), interpretedBy: z.enum(['model', 'rules']),
}).refine(data => data.noMatch === (data.results.length === 0), 'Inconsistent search results')
  .refine(data => data.results.every(result => result.event.status === 'published'), 'Unpublished search result');

export function queryInput(query: string) {
  const parsed = searchRequestSchema.safeParse({ query });
  if (!parsed.success) throw new Error('Enter a question using 1–500 characters.');
  return parsed.data;
}

export async function searchEvents(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const body = await apiRequest<unknown>('/api/search', { method: 'POST', json: queryInput(query), signal });
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(200, 'The search response could not be read. Please try again.');
  return parsed.data;
}

export type SearchState = { status: 'idle' } | { status: 'invalid'; message: string }
  | { status: 'loading'; query: string } | { status: 'success'; query: string; response: SearchResponse }
  | { status: 'error'; query: string; error: unknown };

/** Latest submitted query wins, including when an old transport ignores abort. */
export function createSearchController(load: typeof searchEvents, update: (state: SearchState) => void) {
  let stop = () => {};
  return {
    submit(input: string): boolean {
      stop();
      let query: string;
      try { query = queryInput(input).query; }
      catch { update({ status: 'invalid', message: 'Enter a question using 1–500 characters.' }); return false; }
      stop = startResource(signal => load(query, signal), state => {
        if (state.status === 'success') update({ status: 'success', query, response: state.data });
        else if (state.status === 'error') update({ status: 'error', query, error: state.error });
        else update({ status: 'loading', query });
      });
      return true;
    },
    cancel() { stop(); },
    reset() { stop(); update({ status: 'idle' }); },
  };
}
