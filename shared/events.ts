import { z } from 'zod';

// Null means unknown. Never infer free admission or eligibility from absent text.
export const eventDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  timezone: z.literal('America/Los_Angeles'),
  location: z.string().max(500).nullable(),
  eligibility: z.string().max(1000).nullable(),
  costCents: z.number().int().nonnegative().nullable(),
  food: z.enum(['advertised', 'not-advertised', 'unknown']),
  beginnerFriendly: z.boolean().nullable(),
  registrationUrl: z.string().url().refine(s => /^https?:\/\//.test(s)).nullable(),
  registrationDeadline: z.string().datetime({ offset: true }).nullable(),
  sourceUrl: z.string().url().refine(s => /^https?:\/\//.test(s)).nullable(),
  sourceKind: z.enum(['flyer', 'engagesc', 'usc-calendar']),
  evidence: z.array(z.object({ field: z.string(), excerpt: z.string() })),
  uncertainties: z.array(z.string()),
});
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type PublishedEvent = EventDraft & {
  id: string;
  status: 'published';
  confirmation: 'organizer-confirmed' | 'source-imported';
  updatedAt: string;
};
export type EventListResponse = { events: PublishedEvent[]; mode: 'scaffold' | 'live' };
