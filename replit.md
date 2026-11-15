# Trojan Signal on Replit

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

- Current import setup verified the running preview, PostgreSQL, and public-feed imports (290 new events). `/api/health` reports `status: ok`, `mode: live`, and `modelConfigured: false`. The type check, 33 server tests, and 35 simulated AI tests passed. `MODEL_API_KEY` and `ORGANIZER_ACCESS_CODES` are missing in this workspace: organizer sign-in is disabled, search uses basic matching, and extraction requires manual entry. No paid provider checks were run; historical live-check records do not verify this workspace's current configuration.

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
- Each outbound attempt counts, including errors, timeouts and invalid responses. Search may use two attempts (interpretation and summary); extraction uses one. Calls rejected by the gate never reach the provider or enter a queue.
- Exhausted/busy extraction returns 503 without saving a draft. Search retains deterministic results, discloses basic matching or a basic summary in its answer, and supplies `fallbackReason` (`capacity`, `unavailable`, or `not_configured`) alongside `interpretedBy`.
- Limits are shared across clients in one server process, not persisted or coordinated across replicas; restart resets the budget. This is not a dollar/token ceiling. Set provider-side billing controls for a hard spending limit.
- `npm run test:ai` includes simulated budget exhaustion, boundary reset, concurrency, failure cleanup and search/extraction regression checks. It makes no paid requests.
