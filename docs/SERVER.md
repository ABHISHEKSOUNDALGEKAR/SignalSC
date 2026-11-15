# Server

Express API in `server/`, contract in `shared/api.ts`.

| File | Purpose |
|---|---|
| `index.ts` | App setup, body limits, static client, error handler, starts the feed refresh |
| `routes.ts` | All `/api` routes, ownership checks, rate limits |
| `store.ts` | Postgres store (`DATABASE_URL`) or in-memory store for local development |
| `auth.ts` | Organizer access codes and signed session cookie |
| `model.ts` | OpenAI-compatible chat client (JSON mode, image input, timeout) |
| `extract.ts` | Flyer/announcement → validated draft; unknowns stay null and are listed in `uncertainties` |
| `search.ts` | Question → constraints (model, with a rules fallback) → deterministic filters → grounded answer |
| `importer.ts` | Public EngageSC feed → `source-imported` events, refreshed on start and hourly |
| `import-engagesc.ts` | One-off import: `npm run import:engagesc [-- <feed-url>]` |
| `ics.ts` | `.ics` export and feed parsing |
| `time.ts` | America/Los_Angeles conversions, including daylight saving |
| `env.ts` | Production detection |
| `tests/` | `npm run test:server` |

## Guarantees

- Students only see `published` events; drafts are visible only to the organization that created them.
- One organization cannot edit or cancel another organization's events (403).
- Publishing requires title, start time and location (422 lists what is missing).
- Search filters are applied in code. The model only interprets the question and words the answer; result ids it returns are checked against the retrieved set. No-match answers are written without the model.
- Unknown cost never matches "free"; unknown food never matches "food"; unknown suitability never matches "beginner-friendly". Excluded counts are reported.
- Flyer and feed text is passed to the model as data with instructions not to follow it. Keys stay on the server.
- In production (`npm start`), `DATABASE_URL`, `SESSION_SECRET` and `ORGANIZER_ACCESS_CODES` must be set; the development access codes are never active.

## Imported events

The school-wide EngageSC feed is public and updates hourly. Each record keeps its EngageSC link as `sourceUrl`, its host as `organizationName`, and is labeled `source-imported`.

- The feed hides most locations behind USC sign-in. Those events have `location: null` and the note "Location is shown on EngageSC after USC sign-in." in `uncertainties`.
- Food is `advertised` only when the listing explicitly offers it (the matching text is kept in `evidence`); otherwise it is `unknown`. Cost is `0` only when the listing says admission is free.
- Records are matched by the feed's event id, so a refresh updates in place and never duplicates. Organizer-published events are never touched by the import.
- Known limit: an event deleted from the feed stays listed until it has passed.

## Checks

`npm run test:server` runs 33 checks without a database, a model or the network: search rules, time zones, flyer post-processing, publish and edit rules, calendar export, feed mapping, and the HTTP flow for sign-in, draft privacy, ownership, publishing and cancelling.

Also verified by hand: the Postgres statements against an embedded Postgres engine, and the importer against the live feed (about 290 upcoming events). Still to confirm on the deployment: extraction and question interpretation with the real model key.

`npm audit` reports one advisory in `zod` 3 that is only fixed in the next major version. Request bodies are size-limited before validation; the upgrade is deferred.

## Environment

See `.env.example`. Without `DATABASE_URL` the server uses memory; without a model key, uploads create an empty draft for manual entry and search uses the rules parser.
