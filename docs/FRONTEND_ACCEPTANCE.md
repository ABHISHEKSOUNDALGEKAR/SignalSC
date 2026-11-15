# Frontend acceptance handoff — Step 7

Date: November 14, 2026. Branch: `frontend-stuff`, based on `acaea67`, with uncommitted Step 7 changes. Prepared for Abhishek's test notes; no message or deployment was sent.

## Result

Local acceptance passed against the real Express API and compiled React client using disposable in-memory data. **The overall Step 7 gate remains incomplete until the published Replit workflow is tested.** The user confirmed there is no published URL yet. Step 8 was not started.

- 68 unit/render tests and seven live API/asset tests passed.
- Six calendar exports passed the independent Python `icalendar` 7.3.0 parser. A seventh file downloaded through Chrome matched the detail page's November 17, 2026, 6–7 PM PST display.
- Desktop Chrome demonstrated announcement → manual review → 422 correction → publish → Discover → Ask → detail → Save → reload → calendar download and supplied registration link. At 320 CSS pixels, edit/cancel updated Saved, cancellation stayed visible after reload, and a forced connection failure recovered through retry.
- Unknown cost/food stayed Unknown; strict free/food searches excluded unknown values. Private drafts stayed out of public detail/calendar/feed/search. Cancelled records stayed out of feed/search. USC calendar and EngageSC provenance remained distinct.
- Invalid access codes, correctly signed expired cookies, separate A/B cookie sessions, forbidden edits, unavailable images/events/saves, empty feeds, no-match, route refreshes, required build assets, and the manifest were checked. The expired-cookie check was an API check; a timed expiry was not waited out in Chrome.

See the Step 7 run in `../tests.md` for commands and evidence. All event names and input material were synthetic. No live organizer data was used.

## Frontend fixes

1. Ignore the originating tab's session broadcast. Previously, its own sign-in/out message remounted the workspace and could lose focus. Other-tab and legacy notifications still invalidate the session. Unit regression and browser sign-in/out/switching checks passed.
2. Explain the backend's existing one-hour calendar reservation when the event end is unknown. The Ends fact remains Unknown; the calendar action references the explanation for assistive technology. Rendering and browser checks passed.

## Backend/contract notes for Abhishek

- `shared/api.ts` says cancelled events are returned only to organizers. The actual detail and calendar routes intentionally return cancelled records publicly, allowing existing Saved entries to show cancellation; calendar exports have `STATUS:CANCELLED`. Feed/search exclusion passed. Please reconcile the contract comment with the intended policy; frontend code follows the current routes. No shared/server changes were made.
- Unknown-end exports currently reserve one hour in `server/ics.ts`. The frontend now discloses this placeholder rather than presenting it as a known event end. Confirm the desired export policy before changing that behavior.
- Model keys and Postgres were unavailable in this local run. Text/image requests used the honest manual-extraction fallback. Real model extraction, external feed importing, database persistence, deployed HTTPS/cookies, and Replit configuration still need environment-specific verification.

## Replit check still required

Once the deployment is available, record its URL/build and use authorized disposable demo data to repeat the full workflow, refresh each hash route, and verify assets/API responses. Check actual configured organizer sessions and model/database behavior there. Local `demo-a`/`demo-b` are development-only credentials, not deployment credentials. Physical phone coverage is still unavailable; this run used Chrome emulation.

## Local reproduction

Use separate disposable servers, not an existing teammate's database. Commands and guard conditions are listed in `tests.md`. Existing development services on ports 3001 and 5174 were not restarted. Step 7's servers on ports 3002/3003 are stopped after verification; their memory records do not persist. Calendar artifacts remain in `/private/tmp/trojan-step7-calendar/`, and the browser download is `~/Downloads/SYNTHETIC-Step-Seven-Browser-Meetup.ics`.
