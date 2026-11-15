import type { EventRecord } from '../../shared/api';

/** Synthetic fixtures used only by tests and the explicit local fixture server. */
export function eventFixture(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'synthetic-free', title: '[SYNTHETIC] Campus meetup', description: 'Synthetic event for local frontend verification.',
    startsAt: '2026-11-16T18:00:00-08:00', endsAt: '2026-11-16T19:00:00-08:00', timezone: 'America/Los_Angeles',
    location: 'Synthetic Campus Room', eligibility: 'USC students', costCents: 0, food: 'advertised', beginnerFriendly: true,
    registrationUrl: 'https://example.com/register', registrationDeadline: null, sourceUrl: 'https://example.com/source', sourceKind: 'flyer',
    evidence: [{ field: 'food', excerpt: 'Synthetic flyer: snacks advertised.' }], uncertainties: ['Synthetic example: dietary suitability is unknown.'],
    status: 'published', confirmation: 'organizer-confirmed', organizationName: 'Synthetic Test Organization', flyerUrl: null,
    publishedAt: '2026-11-14T12:00:00-08:00', updatedAt: '2026-11-14T12:00:00-08:00', ...overrides,
  };
}
