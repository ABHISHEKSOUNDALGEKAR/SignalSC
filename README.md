# Trojan Signal

Trojan Signal turns the flyers student orgs already make into checked, searchable events, so Trojans can ask “what can I go to tonight?” and find source-linked answers.

## Start developing

Requires Node.js 22.17+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Frontend: http://localhost:5173. Backend: http://localhost:3001/api/health. The frontend proxies `/api` requests to port 3001; if changing that port, also change `vite.config.ts`.

```sh
npm run typecheck
npm run build
npm start
```

The production server serves the built frontend and API on `PORT` (default 3001). On Replit use `npm run dev` for development, `npm run build` as the build command, and `npm start` for deployment. Set `DATABASE_URL`, `SESSION_SECRET`, `ORGANIZER_ACCESS_CODES` and a model key in Replit Secrets (see `.env.example`).

## Current status

### AI configuration and checks

Set `MODEL_API_KEY` securely for your own OpenAI account; the default model is
`gpt-4o-mini`. Existing `AI_INTEGRATIONS_OPENAI_*` configurations and custom
OpenAI-compatible endpoints remain supported (see `.env.example`).
`/api/health` reports whether a key is configured, not whether the account has
credits or the provider is reachable.

Run `npm run test:ai` for isolated, simulated-provider tests covering text/image
requests, extracted unknown fields, constrained search, unavailable-provider
errors, and unconfigured fallbacks. These tests make no external API calls.
Successful live extraction and model-interpreted search must also be checked
with an active, funded provider account.

Without a key, extraction returns a manual draft. Provider failures return 503
for extraction and leave no draft behind. Search falls back to deterministic
rules when its model request fails. Provider response bodies are not logged.

**Server (`server/`)**: implemented. Organizer access-code sign-in, flyer/announcement extraction into private drafts, review and publish, edit and cancel with ownership checks, constrained natural-language search, `.ics` export, and an importer for public calendar feeds. It has been exercised locally in memory mode with a stand-in model. Postgres and a model key are supplied through environment variables (see `.env.example`). See `docs/SERVER.md`.

**Client (`client/`)**: in progress. The shell exists; the screens in `docs/WORK_SPLIT.md` (Ask, Discover, event detail, Saved, Organizer) are being built against the contract in `shared/api.ts`.

Not included yet: student accounts, real email or SMS delivery, calendar synchronization, and moderated community posts. Demo events are labeled as demo data.

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
- “Tonight after 5” needs explicit date boundaries. Schedule-conflict checks require actual student availability and are outside the initial scope.
- Save model keys on the server. Enforce event ownership in backend routes, not just hidden UI controls.

## MVP and stretch goals

MVP: flyer extraction, reviewed publication, source-linked cards, constrained search, truthful empty results, organizer edit/cancel, saves, and `.ics` downloads.

Stretch: EngageSC importer after testing the public feed, additional USC source connector, weekly digest preview, PWA installation. Real email, calendar synchronization, moderated community posts, and wider pilots come later.
