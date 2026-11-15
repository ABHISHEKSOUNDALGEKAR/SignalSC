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

- Import setup was verified with the running preview and `/api/health`: PostgreSQL is connected (`mode: live`), the public feed imports events, and no model key is configured. The production build, 33 server tests, and 24 simulated AI tests passed. No live AI requests were made.

- The existing `DATABASE_URL` is used by the project's PostgreSQL store. Tables are created automatically at startup. Without a database, development uses temporary in-memory storage; production requires PostgreSQL.
- `SESSION_SECRET` is supplied through Replit Secrets. Never commit credentials.
- Development organizer access defaults to the demo codes documented in `.env.example`. Configure private `ORGANIZER_ACCESS_CODES` before real use; production has no demo-code fallback.
- AI extraction and natural-language search require `MODEL_API_KEY`, or the existing supported `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`. Optional model settings are documented in `.env.example`. No AI credentials were invented or added during import setup.
- The user approved BluesMinds as the AI provider. Match its key to `MODEL_BASE_URL=https://api.bluesminds.com/v1` and the verified `MODEL_NAME=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`; the adapter uses this model's documented non-reasoning mode. Keep credentials in Secrets.
- `npm run test:ai:live -- --confirm-live` spends real provider credits on isolated synthetic fixtures. Do not add it to automatic validation; the ordinary `test:ai` suite uses simulated responses.
- `npm run test:browser` runs interactive organizer and saved-event browser coverage with isolated in-memory data and deterministic extraction fixtures.
- The React interface exposes Ask, Discover, event details, device-local Saved events, and the organizer review/publish workspace. Navigation uses hash routes. The web manifest supplies app metadata; offline operation is not supported.
- Run `node --import tsx --test tests/*.test.ts` for API lifecycle, ownership, empty-state, campus-time, and model adapter regression checks. Tests isolate their data and provider configuration from the running development app.
- Keep the existing React/Vite, Express, shared types, npm, and PostgreSQL structure.
