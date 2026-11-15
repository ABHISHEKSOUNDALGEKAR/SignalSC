# SignalSC on Replit

The product is named **SignalSC** (package identifier `signalsc`). Preserve legacy browser-storage migration when changing saved-event or feedback keys so existing users keep their data.

## Run

- Runtime: Node.js 22.17+ and npm.
- Install the existing dependencies with `npm ci`.
- Use the **Start application** workflow (`npm run dev`).
- Vite serves the preview on `0.0.0.0:5000` and proxies `/api` to Express on port 3001.
- Keep `PORT` unset or set to `3001` during development so the API matches the Vite proxy.
- Check the API through `/api/health`.
- Run `npm run build` to type-check and build the frontend and server. `npm start` serves the built app and API together on `PORT` (default 3001).
- After task merges, `scripts/post-merge.sh` restores locked dependencies with `npm ci` and runs the type-checked build. Replit then restarts running workflows; the server initializes its existing database tables at startup.

## Configuration and current limitations

- Current import setup verified the running preview, PostgreSQL, and public-feed imports (290 new events). After the user supplied `MODEL_API_KEY` and `ORGANIZER_ACCESS_CODES` securely, the app restarted successfully and `/api/health` reported `status: ok`, `mode: live`, and `modelConfigured: true`. The production build, dependency audit (zero vulnerabilities), type check, 33 server tests, and 35 simulated AI tests passed. Organizer codes were accepted at startup; signed-in organizer UI was not verified. No paid provider checks were run: key presence and historical live-check records do not verify this workspace's current provider access, credits, or live extraction/search.

- The existing `DATABASE_URL` is used by the project's PostgreSQL store. Tables are created automatically at startup. Without a database, development uses temporary in-memory storage; production requires PostgreSQL.
- `SESSION_SECRET` is supplied through Replit Secrets. Never commit credentials.
- Private `ORGANIZER_ACCESS_CODES` are supplied through Replit Secrets. There are no demo defaults: development sign-in is disabled when unset, and production refuses to start without codes, `SESSION_SECRET`, or `DATABASE_URL`. Codes and organization identifiers must be unique; keep organization names stable because they determine event ownership.
- AI extraction and natural-language search require `MODEL_API_KEY`, or the existing supported `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`. Optional model settings are documented in `.env.example`. No AI credentials were invented or added during import setup.
- The user approved BluesMinds as the AI provider. Match its key to `MODEL_BASE_URL=https://api.bluesminds.com/v1` and the verified `MODEL_NAME=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`; the adapter uses this model's documented non-reasoning mode. Keep credentials in Secrets.
- `npm run test:ai:live -- --confirm-live` spends real provider credits on isolated synthetic fixtures. Do not add it to automatic validation; the ordinary `test:ai` suite uses simulated responses.
- `npm run test:browser` runs interactive organizer and saved-event browser coverage with isolated in-memory data and deterministic extraction fixtures.
- The React interface exposes Ask, Discover, event details, device-local Saved events, and the organizer review/publish workspace. Navigation uses hash routes. The web manifest supplies app metadata; offline operation is not supported.
- Run `node --import tsx --test tests/*.test.ts` for API lifecycle, ownership, empty-state, campus-time, and model adapter regression checks. Tests isolate their data and provider configuration from the running development app.
- Keep the existing React/Vite, Express, shared types, npm, and PostgreSQL structure.

## AI usage limits

- All model consumers share a fail-fast admission gate: `MODEL_REQUEST_BUDGET` (default 120 attempts), `MODEL_BUDGET_WINDOW_MS` (default 3,600,000), and `MODEL_MAX_CONCURRENT` (default 4). Set the request budget to 0 to disable paid calls; invalid values fail startup.
- Each outbound attempt counts, including errors, timeouts and invalid responses. Search may use two attempts (interpretation and summary); flyer extraction uses one. Calendar enrichment uses one attempt per batch of up to eight unique source texts. Calls rejected by the gate never reach the provider or enter a queue.
- Calendar enrichment recovers food, beginner suitability, literal topics, admission prices, eligibility, and complete RSVP links only with exact source excerpts. It never fetches event pages or hidden sign-in details. Imported records retain their source URL and source-imported label. Topics are optional for compatibility with existing records and contribute to search matching.
- Enrichment results (including unknowns and conflicts) are cached in existing store metadata by a versioned SHA-256 hash of the complete supplied title and description. Atomic, owner-fenced 60-second leases prevent independent importers from filling the same cache miss. Busy imports keep source-only details without waiting; a later refresh reuses the result. Pre-send crashes recover after lease expiry. Immediately before sending, attempts receive a persistent 24-hour retry cooldown, retained after crashes, errors, or malformed responses; budget/concurrency rejections release unattempted leases. Changed content is re-extracted. Sources over 12,000 characters are left unknown rather than truncated for AI. Imports continue with grounded basic details if the provider or cache coordination is unavailable.
- Exhausted/busy extraction returns 503 without saving a draft. Search retains deterministic results, discloses basic matching or a basic summary in its answer, and supplies `fallbackReason` (`capacity`, `unavailable`, or `not_configured`) alongside `interpretedBy`.
- With PostgreSQL, atomic metadata reservations coordinate all model consumers across clients, server restarts, manual import processes, and replicas connected to the same database. Database time controls budget resets and 60-second concurrency-slot expiry after crashes. All replicas must use identical limit settings; mismatches fail closed until the next window. Database errors/corrupt admission state block paid calls, never silently switch to local counters. Database connections and lock waits have bounded timeouts. Database-free development/test mode still uses per-process limits that reset on restart. These are request-attempt limits, not a dollar/token ceiling or a guarantee that a timed-out request stopped at the provider. Set provider-side billing controls for a hard spending limit.
- `npm run test:ai` includes simulated budget exhaustion, boundary reset, concurrency, failure cleanup and search/extraction regression checks. Shared-coordination integration tests start a disposable local PostgreSQL (require `initdb` and `pg_ctl`, otherwise explicitly skip), use independent pools and child processes, and cover crashes, persistent spent attempts, cache fencing/cooldowns and lease expiry. They never connect to the app database or make paid requests.
