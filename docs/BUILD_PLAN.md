# Build plan

## API proposal (only health and GET events exist today)

- `GET /api/health`: service status and scaffold/live mode.
- `GET /api/events`: published events; currently returns an empty array.
- `POST /api/organizer/drafts`: authorized flyer upload, extraction, and private draft creation.
- `PATCH /api/organizer/drafts/:id`: owner-only corrections.
- `POST /api/organizer/drafts/:id/publish`: validate required facts and record confirmation.
- `PATCH /api/organizer/events/:id`: owner-only edit/cancel with update timestamp.
- `POST /api/search`: interpret query, validate filters, retrieve published records, return cards and match explanations.
- `GET /api/events/:id/calendar.ics`: escaped iCalendar download with stable UID and correct timezone handling.

Agree on request/response types in `shared/` before implementing consumers. Save events locally for the first demo if student accounts are out of scope; organizer accounts and ownership checks are required before publishing is opened to real users.

## Sequence

1. Connect Postgres, organizer auth, and a simple manually entered draft.
2. Complete review → publish → event feed end to end.
3. Add image upload and extraction into the existing draft flow.
4. Add validated query interpretation and deterministic filtering.
5. Add sources, save, calendar export, and cancellation behavior.
6. Test real flyers with organizers, fix errors, rehearse and record.

## Data model to implement

Organizations and memberships; private event drafts; published events; source records and image keys; publication/update timestamps; cancellation state. Link drafts/events to authenticated owners. Imported records use external source IDs for deduplication; flag suspected cross-source duplicates for review instead of automatically merging uncertain matches.

## Acceptance checks

- Missing date/year/location is flagged, not invented.
- Unknown cost cannot match free; unknown suitability cannot match a strict beginner request.
- Drafts/cancelled/past events never leak into applicable student searches.
- Two different organizers cannot edit each other's events.
- Flyer instructions cannot override extraction rules or expose secrets.
- No-match searches explicitly say no match; every result links to a stored source.
- Calendar export round-trips the correct date/time, including daylight saving changes.
- Imported records retain provenance and are never labeled organizer-confirmed without review.

## Demo

Missed-event story → upload an ambiguous flyer → correct and publish → ask a constrained student question → open source evidence → show a truthful no-match → save/export → phone layout → actual test results and pilot proposal.

Use synthetic fixtures clearly labeled as such until real organizers supply material. Never invent participant quotes, test metrics, or partnerships.
