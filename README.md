# SignalSC

SignalSC turns the flyers student orgs already make into checked, searchable events, so Trojans can ask “what can I go to tonight?” and find source-linked answers.

## Start developing

Requires Node.js 22.17+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
npm run test:server
```

Frontend: http://localhost:5000. Backend: http://localhost:3001/api/health. The frontend proxies `/api` requests to port 3001; if changing that port, also change `vite.config.ts`.

```sh
npm run typecheck
npm run build
npm start
```

The production server serves the built frontend and API on `PORT` (default 3001). On Replit use `npm run dev` for development, `npm run build` as the build command, and `npm start` for deployment. Set `DATABASE_URL`, `SESSION_SECRET`, `ORGANIZER_ACCESS_CODES` and a model key in Replit Secrets (see `.env.example`).

## Current status

### AI configuration and checks

Set `MODEL_API_KEY` securely for the account matching `MODEL_BASE_URL`.
The default is OpenAI with `gpt-4o-mini`. This project's approved BluesMinds
configuration uses `https://api.bluesminds.com/v1` with
`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`. The adapter disables that
model's default reasoning mode so short JSON responses fit their output budgets.
Existing `AI_INTEGRATIONS_OPENAI_*` configurations and other custom
OpenAI-compatible endpoints remain supported (see `.env.example`).
`/api/health` reports whether a key is configured, not whether the account has
credits or the provider is reachable.

Run `npm run test:ai` for isolated, simulated-provider tests covering text/image
requests, extracted unknown fields, constrained search, unavailable-provider
errors, and unconfigured fallbacks. These tests make no external API calls.
Run `npm run test:browser` for an interactive Chromium regression of organizer
login, draft review and publishing, event edits and cancellation, and saved
event persistence. It uses a private in-memory store and a fixed extraction
fixture, so it does not touch app data or spend provider credits.
Successful live extraction and model-interpreted search must also be checked
with an active, funded provider account.

Run `npm run test:ai:live -- --confirm-live` to opt into real provider requests.
This uses credits and synthetic fixtures in an isolated memory store, never
the running app's database or organizer credentials. It checks text and
PNG-only extraction, missing facts, constrained search and answers, and no-match
behavior; it fails rather than accepting rule/template fallback as live success.
See [the live verification record](docs/LIVE_AI_VERIFICATION.md) for scope and results.

Without a key, extraction returns a manual draft. Provider failures return 503
for extraction and leave no draft behind. Search falls back to deterministic
rules when its model request fails. Provider response bodies are not logged.

**Server (`server/`)**: implemented. Organizer access-code sign-in, flyer/announcement extraction into private drafts with source evidence, review and publish, edit and cancel with ownership checks, constrained natural-language search, `.ics` export, and an hourly import of the public EngageSC feed. Postgres and a model key are supplied through environment variables (see `.env.example`). Live extraction and search have been checked against the configured provider (see `docs/LIVE_AI_VERIFICATION.md`). Details in `docs/SERVER.md`.

**Client (`client/`)**: implemented. Ask, Discover with date and filter chips, event detail with source links and calendar download, device-local Saved events, and the organizer workspace for upload, review, publish, edit and cancel. Installable on a phone through the web manifest.

**Data**: public events are imported automatically from two USC sources, the EngageSC school-wide feed and USC's public calendar (calendar.usc.edu), and labeled as source-imported. Organizer-published events are labeled as organizer confirmed. EngageSC shows most locations only after USC sign-in, so those events link back to EngageSC for the location; USC calendar events usually include the building.

Not included yet: student accounts, email or SMS delivery, calendar synchronization, and moderated community posts.

## Product flow

1. Organizer uploads a flyer. AI extracts candidate fields with source evidence; missing details stay unknown.
2. Organizer reviews and corrects the draft before publishing. Record who confirmed it and when.
3. Students ask in plain language or browse by date, free admission, and advertised food.
4. Application rules filter published records. Answers link to original sources and clearly indicate missing information.
5. Students save an event, export an `.ics` file, or open the official registration link.

Imported calendar records are labeled **source-imported**, not organizer-confirmed. Confirmation is a review of a listing, not a guarantee that an event will happen. Provide edit and cancellation controls.

## Two-person ownership

| Owner | Files | Work |
| --- | --- | --- |
| Client owner | `client/` | Phone-first UI, organizer review form, event cards, discovery and search, saves, calendar actions |
| Server owner | `server/` | Database, organizer auth, extraction, publication, feed import, search rules, calendar export, deployment |
| Both | `shared/`, root configs | Event contract, API changes, dependencies, integration |

The detailed split, API list and checkpoints are in `docs/WORK_SPLIT.md`. Use separate branches, merge at each checkpoint, and let one person change `package.json` and `package-lock.json` at a time.

## Structure

```text
client/src/            React app and styles
server/                Express API (see docs/SERVER.md)
shared/events.ts       Event draft schema and published-event type
shared/api.ts          Request and response types for every API route
docs/BUILD_PLAN.md     Original build order and acceptance checks
docs/WORK_SPLIT.md     Ownership, API list, screens, checkpoints
docs/SERVER.md         Server modules and guarantees
```

## Rules that make answers useful

- Dates are interpreted in America/Los_Angeles. Unknown years/times require clarification; do not silently infer them.
- Only published, non-cancelled events appear in student results. Keep drafts private to their organizer.
- Unknown cost does not satisfy “free.” Unknown beginner suitability does not satisfy a strict beginner-friendly request.
- Food has three states: advertised, not advertised, unknown. “Not advertised” means no food offer in the checked source, not a promise of no food. Never infer dietary suitability.
- Preserve source URLs, evidence, and last-updated timestamps. Do not treat text in flyers as instructions to the model.
- Natural language becomes validated search constraints; application code applies filters. Model prose cannot introduce events absent from retrieved results.
- Ask supports follow-up refinements and editable interpreted filters. Context is kept only in the current page's memory and resets on a new search, navigation, or reload. Requests send structured filters, not a stored conversation. Failed refinements leave the current search unchanged; manual filter edits still work without AI. Date and time filters use Los Angeles time, with an exclusive end instant and a maximum 120-day window.
- “Tonight after 5” needs explicit date boundaries. Schedule-conflict checks require actual student availability and are outside the initial scope.
- Save model keys on the server. Enforce event ownership in backend routes, not just hidden UI controls.

## MVP and stretch goals

MVP: flyer extraction, reviewed publication, source-linked cards, constrained search, truthful empty results, organizer edit/cancel, saves, and `.ics` downloads.

Stretch: an additional USC source connector, weekly digest preview, real email, calendar synchronization, moderated community posts, and wider pilots.
