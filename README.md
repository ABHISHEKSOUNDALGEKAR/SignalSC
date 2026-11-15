# Trojan Signal

Trojan Signal turns the flyers student orgs already make into checked, searchable events, so Trojans can ask “what can I go to tonight?” and find source-linked answers.

## Start developing

Requires Node.js 22.17+ and npm. Open **this folder**, not the parent assignment-coach repository.

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

The production server serves the built frontend and API on `PORT` (default 3001). On Replit use `npm run dev` for development, `npm run build` as the build command, and `npm start` for deployment. Configure database, storage, and secrets in Replit when those adapters are implemented.

## Current status

This is a fresh starter, not a completed event app. Implemented: React/TypeScript frontend shell, Discover and Organizer introductory views, Express service, health endpoint, empty events endpoint, validated shared draft schema, development proxy, and production build.

Still to build: authentication and organizer authorization, Postgres persistence, image storage/upload, multimodal extraction, organizer review and publication, actual event cards, natural-language search, filters, saves, calendar export, feed import, and PWA support. No model calls or fake real-world events are included. No production auth or persistence is claimed.

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
| You + Codex | `client/` | Phone-first UI, organizer review form, event cards, discovery/search, saves and calendar actions |
| Teammate + Claude Code | `server/` | Auth, database, storage, extraction, publication, feed ingestion, search rules and export |
| Coordinate together | `shared/`, root configs | Event contract, API changes, dependencies and integration |

Use separate branches. Choose one owner for shared schema and package-lock changes. Integrate a working upload → review → publish → discover flow before adding digest or recommendation features.

## Structure

```text
client/src/       React app and styles
server/           Express backend
shared/events.ts  Zod event-draft schema and response types
docs/BUILD_PLAN.md  API proposal, build order, and acceptance checks
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

## GitHub

Git is initialized locally on `main`. Create an empty GitHub repository named `trojan-signal` (without a generated README), then run these from this folder using your actual repository URL:

```sh
git remote add origin https://github.com/YOUR_USERNAME/trojan-signal.git
git push -u origin main
```

No remote, license, public deployment, or university affiliation is assumed. Agree on a license before public reuse.
