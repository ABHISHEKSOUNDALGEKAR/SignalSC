# Trojan Signal on Replit

## Run

- Runtime: Node.js 22.17+ and npm.
- Install the existing dependencies with `npm ci`.
- Use the **Start application** workflow (`npm run dev`).
- Vite serves the preview on `0.0.0.0:5000` and proxies `/api` to Express on port 3001.
- Keep `PORT` unset or set to `3001` during development so the API matches the Vite proxy.
- Check the API through `/api/health`.
- Run `npm run build` to type-check and build the frontend and server. `npm start` serves the built app and API together on `PORT` (default 3001).

## Configuration and current limitations

- The existing `DATABASE_URL` is used by the project's PostgreSQL store. Tables are created automatically at startup. Without a database, development uses temporary in-memory storage; production requires PostgreSQL.
- `SESSION_SECRET` is supplied through Replit Secrets. Never commit credentials.
- Development organizer access defaults to the demo codes documented in `.env.example`. Configure private `ORGANIZER_ACCESS_CODES` before real use; production has no demo-code fallback.
- AI extraction and natural-language search require `MODEL_API_KEY`, or the existing supported `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`. Optional model settings are documented in `.env.example`. No AI credentials were invented or added during import setup.
- The imported React interface is a development scaffold. It connects to the event-list API but does not yet expose the backend's organizer, search, review, or publishing workflows.
- Keep the existing React/Vite, Express, shared types, npm, and PostgreSQL structure.
