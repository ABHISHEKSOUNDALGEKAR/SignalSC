# Server

Express API in `server/`, contract in `shared/api.ts`.

| File | Purpose |
|---|---|
| `index.ts` | App setup, body limits, static client, error handler |
| `routes.ts` | All `/api` routes, ownership checks, rate limits |
| `store.ts` | Postgres store (`DATABASE_URL`) or in-memory store for local development |
| `auth.ts` | Organizer access codes and signed session cookie |
| `model.ts` | OpenAI-compatible chat client (JSON mode, image input, timeout) |
| `extract.ts` | Flyer/announcement → validated draft; unknowns stay null and are listed in `uncertainties` |
| `search.ts` | Question → constraints (model, with a rules fallback) → deterministic filters → grounded answer |
| `ics.ts` | `.ics` export and feed parsing |
| `time.ts` | America/Los_Angeles conversions, including daylight saving |
| `import-engagesc.ts` | `npm run import:engagesc -- <feed-url>` imports public events as `source-imported` |

## Guarantees

- Students only see `published` events; drafts are visible only to the organization that created them.
- One organization cannot edit or cancel another organization's events (403).
- Publishing requires title, start time and location (422 lists what is missing).
- Search filters are applied in code. The model only interprets the question and words the answer; result ids it returns are checked against the retrieved set. No-match answers are written without the model.
- Unknown cost never matches "free"; unknown food never matches "food"; unknown suitability never matches "beginner-friendly". Excluded counts are reported.
- Flyer and feed text is passed to the model as data with instructions not to follow it. Keys stay on the server.

## Environment

See `.env.example`. Without `DATABASE_URL` the server uses memory; without a model key, uploads create an empty draft for manual entry and search uses the rules parser.
