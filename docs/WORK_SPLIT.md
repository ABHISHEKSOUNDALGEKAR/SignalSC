# Work split (deadline: Sun Nov 15, 11:00 AM PT on Devpost)

| | Abhishek — `server/` | Davis — `client/` |
|---|---|---|
| Owns | Express API, Postgres, organizer access codes, flyer extraction, search, `.ics`, EngageSC import, Replit deployment | All screens, styling, phone layout, saves (localStorage), PWA manifest |
| Shared | `shared/api.ts` and `shared/events.ts` — change only after telling the other person | |
| Pitch | Demo script, test notes, Devpost text | Slide deck, screenshots, video edit |

The API contract is `shared/api.ts`. Build the client against it; until the server lands, mock responses with those types.

## Branches

- Abhishek: `server` branch. Davis: `client` branch.
- Merge to `main` at each checkpoint. Only one person edits `package.json` / `package-lock.json` per checkpoint (say so in chat).

## API (all JSON; types in `shared/api.ts`)

Public
- `GET /api/health` → `HealthResponse`
- `GET /api/events?from&to&free=1&food=1&q=` → `EventsResponse` (published, upcoming, sorted by start)
- `GET /api/events/:id` → `EventResponse`
- `GET /api/events/:id/calendar.ics` → file download (use a plain `<a href>`)
- `POST /api/search` `{ query }` → `SearchResponse`
- `GET /api/flyers/:id` → image

Organizer (cookie session; send `credentials: 'same-origin'`, the default for same-origin fetch)
- `POST /api/organizer/session` `{ accessCode }` → `OrganizerSession` · `GET` same path → session or 401 · `DELETE` → sign out
- `POST /api/organizer/drafts` `CreateDraftRequest` → `DraftResponse` (can take ~5–15 s; show progress)
- `GET /api/organizer/drafts` → `DraftsResponse`
- `PATCH /api/organizer/drafts/:id` `UpdateDraftRequest` → `DraftResponse`
- `POST /api/organizer/drafts/:id/publish` → `EventResponse`, or 422 `PublishErrorResponse` listing `missing` fields
- `GET /api/organizer/events` → `EventsResponse` (own events incl. cancelled)
- `PATCH /api/organizer/events/:id` `UpdateEventRequest` → `EventResponse`

Errors: `{ error: string }` with 400/401/403/404/422/503.

Local demo access codes (development only): `demo-a` → "Demo Org A", `demo-b` → "Demo Org B".

## Real events while developing

`npm run dev` imports the public EngageSC feed into memory on start, so `GET /api/events` returns about 290 real upcoming events with no setup. Things the client should handle for these `source-imported` events:

- `location` is usually `null`; the reason is in `uncertainties[0]` ("Location is shown on EngageSC after USC sign-in."). Show that text and link `sourceUrl` ("View on EngageSC").
- `organizationName` is the host from the feed. `registrationUrl` is `null`; use `sourceUrl`.
- `food` is `advertised` only with a supporting line in `evidence`; most are `unknown`.
- Weekly meetings repeat as separate events in `GET /api/events`. Search results already show each one once.
- `docs/demo-flyers/` has three demo flyers for testing the organizer upload.

## Client screens (Davis)

1. **Ask** — big input + starter prompts; render `answer`, `constraintSummary` chips, result cards with `reason`, and `excluded` notes. If `noMatch`, show the answer plainly.
2. **Discover** — date-grouped list from `GET /api/events`; filter chips Today / This week / Free / Food advertised.
3. **Event detail** — all fields; show "Unknown" for nulls; food as Advertised / Not advertised / Unknown; badge `confirmation` (Organizer-confirmed vs Imported from EngageSC); source link; flyer image; Add to calendar (`.ics` link); Register button if `registrationUrl`; Save.
4. **Saved** — localStorage list of event ids, refetched.
5. **Organizer** — access code sign-in → upload flyer (convert file to base64) or paste text → review form with `uncertainties` highlighted and `evidence` excerpts shown next to fields → Publish (show `missing` on 422) → My events with Edit / Cancel.

Mobile-first: no horizontal scroll, 44px tap targets, visible focus, loading and empty states.

## Checkpoints

| Time | Goal |
|---|---|
| 9:00 PM | Server deployed on Replit with Postgres; client shows real events from `GET /api/events` |
| Midnight | Flyer → review → publish → found via Ask, end to end on the published URL |
| 8:30 AM | Feature freeze; record video |
| 10:30 AM | Devpost submitted with both teammates |
