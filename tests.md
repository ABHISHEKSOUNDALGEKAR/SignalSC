# Frontend test plan and step completion gates

Use this document with `STEP.md`. It defines the checks the implementing agent must perform after each step and the evidence needed before marking that step complete. This is a test plan, not a claim that tests exist or have passed.

## Agent instructions

1. Before implementing a step, read its test section below and identify the affected existing behavior. After implementing it, run the relevant checks and regressions before marking its `STEP.md` checklist complete.
2. Use automated unit tests for important logic: date boundaries, money conversion, request/error handling, form serialization, and saved-ID storage. Use component/integration tests for consequential interactions and browser checks for layout, navigation, focus, downloads, and real API flows.
3. Test observable behavior and outcomes. Avoid assertions tied to component internals, CSS class names, incidental wording, or large snapshots. Do not add unit tests for presentation-only changes when browser verification is sufficient.
4. Inspect current tooling before adding dependencies. At creation of this plan, `package.json` has no test script or test runner. Do not claim `npm test` works. If needed, add a small compatible test setup and document its actual commands, coordinating package/lockfile changes under `STEP.md`. Keep test files within the frontend ownership area where practical.
5. Keep fixtures synthetic, labeled, deterministic, and shaped like the current shared API contract. Deliberately malformed payloads are appropriate for negative tests. Mock the network boundary for isolated tests; use the real server for integration acceptance. A mock passing is not evidence that an endpoint works.
6. Control time and timezone in automated date tests. Test out-of-order responses with controlled deferred responses instead of arbitrary sleeps. Isolate browser storage and organizer sessions between cases.
7. Use disposable local development records for publishing, editing, and cancellation tests. Do not mutate real organizer data or run destructive checks on a published service without authorization. Read-only production smoke checks can still proceed.
8. Fix failures caused by the change, add a focused regression test for meaningful logic bugs, and rerun the failed check plus affected checks. Do not broaden or repeatedly rerun suites without a reason.
9. Record PASS, FAIL, BLOCKED, or NOT RUN with evidence. A required unavailable backend/browser/deployment check stays BLOCKED; do not replace it with a mock and call it complete. Document unrelated failures separately.
10. After every step, provide a short test report using the template at the end. Run `npm run typecheck` after code changes and `npm run build` at step handoff. Documentation-only work needs document/diff verification rather than application tests.

## Test layers and available commands

| Layer | Purpose | Execution |
| --- | --- | --- |
| Unit | Verify pure logic and boundary values | Use the actual configured runner once added; record the command below. |
| Component / mocked integration | Verify rendered states and interactions with controlled API responses | Use the actual configured UI test tools once added; record the command below. |
| Real API integration | Verify client/server agreement, sessions, persistence, and mutation results | Run `npm run dev` with a disposable local backend and inspect behavior/network responses. |
| Browser / end-to-end | Verify the user journey, navigation, storage, focus, and links | Use available browser automation or record reproducible manual checks. |
| Static / production | Catch type errors and build/asset problems | `npm run typecheck`; `npm run build`; then `npm start` to check the built app. |
| Presentation QA | Verify exported slides, screenshots, and video | Open the delivered files and inspect the complete outputs. |

Record configured automated test commands here when implemented:

- Unit: `node --import tsx --test client/tests/*.test.tsx` — Node's built-in test runner with the existing `tsx` dependency; no package changes needed. There is still no `npm test` script.
- Component/integration: the same command includes static React rendering checks for shared states. These do not simulate mounted interactions; use browser checks for those until a DOM interaction runner is configured.
- Browser automation: **No repository browser runner configured; native Chrome checks are recorded in the per-step reports.**
- Production assets (after `npm run build` and `PORT=3002 npm start`): `node --import tsx --test client/tests/production-assets.test.ts`. This deliberately sits outside the unit glob and requires loopback HTTP access.

## Shared fixture set

Build fixtures as needed, not a separate large dataset. Keep private records out of public feed fixtures except in an explicit server-violation check.

| Fixture | Important properties |
| --- | --- |
| Confirmed free event | Upcoming, cost `0`, food advertised, registration/source/flyer URLs, organizer-confirmed. |
| Paid event | Cost `1250` cents, food not advertised, beginner suitability false. |
| Unknown-details event | Nullable optional fields unknown; food unknown; no registration link or flyer. |
| Imported event | Source-imported; test both EngageSC and USC calendar labels. |
| Long-content event | Long title, description, URL, organization, and evidence excerpt. |
| Draft with evidence | Ambiguous/missing time or location, field evidence, unmatched uncertainty, manual/model extraction variants. |
| Lifecycle records | A private draft, published event, cancelled event, unavailable ID, and an event belonging to the second organization. |
| Search responses | Match with reasons/exclusions; strict no-match; delayed success; structured error. |

Use current/frozen future dates for normal cases so events do not silently become past fixtures. Include deliberate past records only when testing their exclusion.

## Step 1 — Frontend foundation

### Unit and component checks

- [ ] API helper sends relative `/api` requests, intended methods/JSON bodies, and same-origin credentials.
- [ ] A successful response returns its intended data. HTTP errors retain status and `{ error }`; 422 also retains `missing`.
- [ ] Network failure, malformed/non-JSON error response, and request cancellation do not crash or produce success states. Aborting navigation must not display a spurious failure.
- [ ] A slower old response cannot replace a newer request's results.
- [ ] Loading, empty, error/retry, and normal content are distinguishable and usable. Retry actually reissues the request.

### Browser and regression checks

- [ ] All implemented navigation destinations open; details/back preserve useful browsing context. Unimplemented later steps are explicitly recorded as pending.
- [ ] Navigation works with keyboard and visible focus; initial shell works at phone and desktop sizes.
- [ ] Initial public requests still work after navigation changes; no new browser exceptions or unhandled promise rejections occur.

**Gate:** foundation checks pass and typecheck/build pass. Later feature behavior is not marked tested just because its navigation exists.

## Step 2 — Discover and event details

### Unit checks

- [ ] Filter serialization sends `free=1` and `food=1` only when active; dates are valid offset-bearing ISO timestamps. Combined/reset filters produce the intended parameters.
- [ ] Date grouping and display use Los Angeles time even when the browser timezone differs.
- [ ] Today and the chosen This week definition produce the intended boundaries; test first/last instants and exact-boundary behavior against the server contract to catch duplicates or omissions.
- [ ] Null cost displays Unknown, `0` displays Free, and `1250` cents displays $12.50. False beginner suitability remains distinct from unknown.
- [ ] Each food value and each confirmation/source combination displays its correct meaning. A USC calendar import is not labeled EngageSC or organizer-confirmed.

### Component and browser checks

- [ ] Real events render in start-time order and date groups. Every filter works alone, in combination, and after reset; empty/no-match/error/retry states are useful.
- [ ] Rapid filter changes do not allow stale results to win. Opening a card fetches the correct event ID.
- [ ] Detail shows all relevant facts, evidence, unknowns, timestamps, source, and provenance without inventing missing information.
- [ ] Missing/broken flyer, missing registration/source, and an unavailable detail ID each produce appropriate UI.
- [ ] Add to calendar is an anchor to the correct `.ics` endpoint and downloads a file from the real server. Register/source links target the supplied URLs.

### Regression checks

- [ ] Navigation, retry handling, and existing organizer/session controls still work where implemented.
- [ ] From a scrolled feed, open a card: details start at the top. Return to browsing: filters and the clicked browsing position are retained.
- [ ] Save controls are checked once Step 5 exists; until then, record that dependency as pending rather than claiming full detail completion.

**Gate:** feed/details work with real responses; filters, unknowns, provenance, and actions pass. Backend violations are recorded for the server owner, not hidden by client-only filtering.

## Step 3 — Organizer workflow

### Unit checks

- [ ] Input validation accepts supported MIME types and rejects unsupported files, empty input, and invalid source URLs according to the shared schema.
- [ ] Test text at its schema limit and one character over. Test encoded image length at the base64 limit and one character over; raw file size is not equivalent to base64 length.
- [ ] Image conversion removes the data URL prefix and preserves the MIME type; file-read failures produce a recoverable error.
- [ ] Form serialization preserves null/zero/false distinctions, three food states, unchanged evidence, and source metadata. Clearing a nullable field sends null rather than accidentally retaining its old value.
- [ ] Money conversion: blank → null, `0` → 0, `12.50` → 1250, `0.29` → 29. Negative, invalid, or excessive-precision amounts receive clear validation rather than silent truncation.
- [ ] Los Angeles time conversion round-trips correctly in winter and summer; registration deadlines follow the same rules. Ambiguous/nonexistent local times require explicit resolution.

### Component and local API integration checks

- [ ] No session/401 shows sign-in; valid code shows the correct organization; invalid code shows an error. Refresh restores a valid session.
- [ ] Image-only, text-only, and image-plus-text requests match `CreateDraftRequest`; manual extraction fallback remains editable.
- [ ] Delayed extraction shows busy messaging without fabricated percentage progress. Repeated clicks do not create duplicate requests; failures retain recoverable input.
- [ ] Draft list reopens the correct draft. Evidence appears beside matching fields; unmatched uncertainties remain visible. Editing does not invent evidence or silently dismiss warnings.
- [ ] Latest corrections are PATCHed before publish. A failed PATCH prevents publication; a successful PATCH allows publication using saved data.
- [ ] A 422 publish error lists `missing`, focuses/associates relevant errors where possible, and preserves edits. Correcting the fields allows a successful retry.
- [ ] Successful publication is visible in My events and refreshed public views; edit updates the same record; cancellation sends `{ cancelled: true }` and displays the returned status.
- [ ] 401/403/404/503 during mutations do not appear successful; controls recover from busy state. Verify by refetching that successful changes persisted.

### Privacy, race, and regression checks

- [ ] Sign out clears private UI. Switching from demo organization A to B does not retain A's drafts/events; a delayed A response cannot repopulate B's screen.
- [ ] Session expiry during review clears private views and requires sign-in without publishing under a different organization.
- [ ] A transient session-check network failure preserves the open review and unsaved edits, displays a connection error, and allows retry. An explicit 401 or organization change still clears private views. Repeat this when changing session handling.
- [ ] With disposable records, a direct unauthorized request for another organization's private draft/edit is denied by the server. Hiding a button alone does not satisfy authorization.
- [ ] Source/description/evidence containing HTML-like text renders as text and executes nothing. Browser assets/network contain no model keys or server secrets.
- [ ] Discover/detail still work after publish/edit/cancel. Check that drafts and cancelled records are absent from applicable public responses; report server failures.

**Gate:** complete a real local sign-in → upload/text → review → publish → edit → cancel journey, plus structured-error and organization-switch cases. Authorization requires real backend evidence.

## Step 4 — Ask

### Unit and component checks

- [ ] Blank/whitespace query is rejected; schema-limit input works and over-limit input is prevented or explained.
- [ ] Starter prompt and typed submission send the intended `{ query }` to `/api/search`.
- [ ] Render `answer`, all constraint chips, result `reason`s, and exclusion reasons/counts accurately; open/save actions use the returned IDs.
- [ ] `noMatch` displays the returned no-match answer without extra invented results or silently relaxed filters.
- [ ] Success → no-match → failure → retry does not leave misleading old answers. Out-of-order searches cannot replace the latest response.
- [ ] Returning from event detail preserves the submitted question and results. After an organizer publish/edit/cancel, clear the old answer and require a fresh submission rather than presenting stale matches as current.
- [ ] Returned model/source text is displayed safely as text.

### Real API and regression checks

- [ ] Find a freshly published synthetic event with a relevant question. Run a strict query with no eligible match and inspect both returned IDs and UI.
- [ ] Unknown cost/food/beginner suitability does not satisfy the corresponding strict request. Verify server response membership as well as displayed labels; backend filtering belongs to Abhishek.
- [ ] Discover filters/details and organizer review/publication remain functional.

**Gate:** matching and no-match responses are grounded in the actual API; race and error paths do not show stale answers as current.

## Step 5 — Saved events

### Unit checks

- [ ] First use with no storage produces an empty list; repeated save deduplicates IDs; unsave removes only the selected ID.
- [ ] Invalid JSON, wrong JSON shape, mixed/invalid entries, and thrown read/write exceptions do not crash the app.
- [ ] Failed writes do not claim persistence; any temporary in-memory state has an honest user-visible status.
- [ ] Refetch handling distinguishes unavailable records from transient failures. A temporary failure does not permanently delete the saved ID.

### Browser and regression checks

- [ ] Save from Discover, Ask, and detail; verify every control and Saved agrees. Unsave in each location and verify synchronization.
- [ ] Refresh and reopen the app: saved IDs persist and current event details are fetched, rather than stale stored records.
- [ ] Mix valid and unavailable IDs: valid cards still appear. Retry a temporary network failure successfully.
- [ ] Edit a saved event through Organizer and confirm Saved shows current data after refetch; cancel it and verify a clear cancellation state when the API retains the record, or graceful unavailability if the API returns 404.
- [ ] Student saves do not interfere with organizer sign-in/out or expose private draft data.

**Gate:** persistence, synchronized controls, current-data refetching, and storage/network recovery pass.

## Step 6 — Mobile, accessibility, and manifest

### Browser and accessibility checks

- [ ] Inspect all five areas at representative widths: 320px, 375–390px, 768px, and 1280px. Include long-content fixtures, errors, and evidence; no horizontal page overflow occurs.
- [ ] At 200% zoom, controls and content remain usable. Interactive touch targets meet the assigned 44px minimum.
- [ ] Use keyboard only for navigation, filters, search, saving, sign-in, review, and cancel confirmation. Focus stays visible, follows a sensible order, and returns appropriately after dialogs.
- [ ] Labels, headings, link/button roles, validation associations, image alternatives, and status announcements are meaningful. Do a brief screen-reader check if available; record it as NOT RUN if unavailable.
- [ ] Check contrast with a measurement tool; food/status/error meaning must not depend only on color. Automated accessibility checks, if available, supplement manual checks.
- [ ] Throttle network and fail requests: busy/error/retry states remain usable on small screens; repeat actions are prevented while mutations are pending.

### Production/manifest checks

- [ ] After `npm run build`, serve with `npm start`. Load the app and verify manifest, declared icon URLs, and start URL resolve to the intended resources without missing assets.
- [ ] Inspect manifest fields and icon dimensions/types; verify display/theme/background settings. If installation is tested, record browser/device and actual outcome.
- [ ] Reload the production app at any directly addressable route implemented by the client; it loads correctly. If navigation is state-only, test its actual refresh behavior and document it.
- [ ] Never infer offline support from the manifest or install UI. No offline test is required unless offline functionality was actually added.

### Regression checks

- [ ] Perform the core student and organizer journeys at a phone width after shared CSS/layout changes; verify taps, focus, dialogs, and action links still work.

**Gate:** required layout, keyboard, touch, and production asset checks pass; unavailable assistive-tool checks are explicitly reported.

## Step 7 — Full integration and final regression

- [ ] Run typecheck/build and the configured automated suite. Record exact commands and outcomes.
- [ ] On a disposable local backend, complete: sign in → create ambiguous flyer/text draft → inspect evidence → correct → publish → Discover → Ask → detail → save → refresh → calendar export → registration link if supplied → organizer edit → cancellation.
- [ ] Inspect a downloaded `.ics` file in a calendar application or independent parser and compare start/end instants to the detail display. Check winter/summer offsets and escaped title/location characters; report export defects to Abhishek.
- [ ] Repeat relevant checks with a past event, private draft, cancelled record, imported record, unknown facts, no-match query, unavailable image/event, expired session, and backend failure.
- [ ] Use separate development sessions for the two organizations to verify backend ownership and UI cache separation.
- [ ] Run the published-URL core flow with authorized demo data once deployment is available; record the URL, build/commit if known, environment, and outcome. Keep deployment-dependent checks blocked until then.
- [ ] Perform a smoke check in the primary desktop browser and at least one phone browser/device when available. If using emulation only, say so; record unavailable device coverage as a limitation.
- [ ] Confirm development fixtures are not silently active in production and there are no app-caused console errors, failed required assets, or accidental external-secret exposure.

**Gate:** required core behavior passes locally and on the published URL, with recorded evidence. Any critical failure blocks final completion. Isolated mock tests do not substitute for this gate.

## Step 8 — Presentation asset QA

- [ ] Open every exported slide: no clipping, missing fonts/images, unreadable content, or unsupported claims; screenshots match the implemented app.
- [ ] Inspect full-resolution screenshots for legibility, useful phone framing, synthetic-data labels, and private information.
- [ ] Watch the entire edited video: text is readable, actions are understandable, narration/audio if present is clear, the core journey and no-match behavior are shown, and playback/export succeeds.
- [ ] Verify deck/video meet the actual team submission format and duration requirements; do not invent limits.
- [ ] Verify final delivered paths/links work for the intended recipients and the handoff identifies the correct versions. Do not send or submit without authorization.
- [ ] If code changed during capture, rerun checks for the affected behavior before presenting it as working.

**Gate:** exported assets open/play successfully and accurately represent verified product behavior.

## Date regression cases to retain

These are fixed test cases for Los Angeles conversion logic, independent of the user's current timezone. Use a frozen clock for filter tests, and test the server's actual range-boundary convention.

| Case | Expected result |
| --- | --- |
| `2026-11-15T07:30:00Z` | Nov 14, 11:30 PM in Los Angeles; group under Nov 14. |
| `2026-11-15T08:30:00Z` | Nov 15, 12:30 AM in Los Angeles; group under Nov 15. |
| Jan 15, 2026, 6:00 PM Los Angeles | `2026-01-16T02:00:00Z` (winter offset). |
| Jul 15, 2026, 6:00 PM Los Angeles | `2026-07-16T01:00:00Z` (summer offset). |
| Mar 8, 2026, 2:30 AM Los Angeles | Nonexistent local time; require correction rather than silent normalization. |
| Nov 1, 2026, 1:30 AM Los Angeles | Ambiguous; require disambiguation between `08:30Z` and `09:30Z`. |
| Today range on Mar 8 / Nov 1, 2026 | Local day spans 23 / 25 hours respectively; do not assume every local day is 24 hours. |

## Minimum regression selection after a change

Run relevant existing automated tests plus the affected row. Expand only if failures or shared dependencies justify it. At Step 7, run the full final regression above.

| Changed area | Minimum behavior to recheck |
| --- | --- |
| API helper / error model | Feed success/failure/retry, session 401, publish 422, cancellation and stale responses. |
| Shared event card / field display | Discover, Ask, Saved, detail links; zero/null/false, food and confirmation labels. |
| Date utilities / filters | Midnight, summer/winter, DST, range boundaries, review-form round-trip, calendar display agreement. |
| Organizer session / cache | Sign-in/out, expiry, organization switching with pending requests, private state cleared. |
| Draft form / mutation handling | Null/money/time conversions, evidence, failed PATCH, 422, successful publish and edit/cancel. |
| Saved storage / state | Deduplication, refresh persistence, all save controls, unavailable IDs, thrown storage errors. |
| Shared CSS / navigation | All five areas at phone/desktop sizes, keyboard focus, long content, core journey. |
| Build config / public assets | Typecheck/build, production startup, direct navigation, API paths, manifest/icons. |
| Documentation / presentation only | Verify links, consistency with current contract, exported assets as applicable, and `git diff --check`; no application test rerun required without code changes. |

## Step test report template

Append reports below or put them in an agreed tracked report file and link them here. Do not check off the plan itself as a substitute for run evidence.

```text
Step / change:
Date, branch, commit or working-tree state:
Environment: local/mock/real API/published URL; browser, viewport, device, timezone
Automated commands and results:
Manual cases and results (reference step bullets or describe the case):
Regression checks and results:
Evidence: relevant output summary, fixture IDs, screenshot/file paths (no secrets)
FAIL / BLOCKED / NOT RUN items and reasons:
Fixes and rerun outcomes:
Completion gate: PASS or INCOMPLETE
```

## Recorded runs

### Step 1 — November 14, 2026

**Scope / environment:** frontend foundation, branch `frontend-stuff`, uncommitted changes based on commit `294b3ab`. Local Node 22.17.1; real local Express API via Vite at `http://localhost:5173`; no `.env` configured, local memory mode. Automated API responses are mocked; browser feed uses the actual API, which returned zero events. Chrome on macOS, desktop at 100% zoom and responsive emulation at 320 × 725 CSS pixels. Physical phone checks and non-Chrome browsers were not run in this step.

**Automated checks — PASS:**

- `node --import tsx --test client/tests/*.test.tsx`: 17 tests passed, 0 failed. Source: `client/tests/foundation.test.tsx`.
- Tests cover request URL/method/body/headers/signal/credentials; GET without a body; 204 sign-out; malformed event-list shapes; structured 401/403/404/422/503 errors and missing fields; non-JSON failure and unreadable success; network/abort propagation; safe network-error copy; out-of-order responses even when abort is ignored; cleanup and retry recovery; hash routes/encoded IDs; accessible shared state markup; escaped source text; and null/zero/false field semantics.
- `npm run typecheck`: passed.
- `npm run build`: passed (Vite client and esbuild server).
- `git diff --check`: passed at handoff.

**Browser and regression checks — PASS:**

- Real initial `/api/events` request displays “Event service connected · 0 published events” and the empty-state message.
- Discover, Ask, Saved, Organizer, and the event-detail preview each open. Later-step capabilities are explicitly marked pending.
- Detail/back retains the connection state. Direct `#event/test-event` navigation and reload open the detail shell, with a Discover fallback for a fresh page.
- Tab/Enter operates the detail back link; Shift+Tab/Enter operates main navigation. Route changes focus the page heading, and the keyboard-focused back link has a visible outline.
- Desktop shell and all five destinations at 320px width were inspected with screenshots/accessibility trees. Navigation wraps and content remains readable without visible horizontal overflow. This is emulation, not a physical phone result.
- DevTools Offline + Refresh connection displays the recoverable connection error. Restoring No throttling + Try again restores the real connected empty state.
- Console inspection found a missing favicon request; added the local SVG favicon and linked it. Reload after the fix showed no app errors; the remaining warning originated from an installed Chrome extension. The deliberately induced offline request produced an expected network error during the failure test.

**Fixes / reruns:** inspection of the existing server revealed sign-out returns HTTP 204; added successful empty-body support and its regression test. Added malformed event-list protection before reading `.events.length`. After these changes, all 17 tests, typechecking, and the production build passed. The favicon correction was verified through a browser reload.

**Pending / not run:** mounted organizer/session UI, mutations, actual cards/filter/search races, saving, full detail actions, and PWA checks belong to Steps 2–7 and are not implemented or claimed tested. The existing organizer introductory navigation remains reachable. HTTP 401/422 handling is verified in the API foundation tests; live organizer behavior remains Step 3. Production/deployed browser journeys and assistive-device coverage remain later-step checks. No new test dependencies, shared contracts, server code, package files, or deployment were changed.

**Completion gate: PASS for Step 1 only.** No Step 2 work started. Await the user's instruction before proceeding.

### Step 2 — November 14, 2026

**Scope / environment:** Discover, filters, event cards, and event details; branch `frontend-stuff`, working-tree changes based on `661e89c`. Node 22.17.1; Chrome on macOS at desktop 100% zoom and 320 × 725 responsive emulation. Browser/API integration ran at `http://127.0.0.1:5174` because port 5173 was already in use. The explicit fixture server used the real Express `apiRouter`, memory store, and calendar/flyer routes with labeled synthetic data. No real organizer records, model calls, database writes, shared contracts, package files, or server implementation were changed.

**Commands / automated evidence — PASS:**

- `node --import tsx --test client/tests/*.test.tsx`: 26 tests passed, including all 17 Step 1 regressions and 9 new Step 2 tests.
- `TZ=Asia/Tokyo node --import tsx --test client/tests/events.test.tsx`: all 9 Step 2 tests passed with a non-campus process timezone.
- New unit/render checks cover all 12 filter combinations/reset, Monday/Sunday and year rollover, Los Angeles midnight grouping/order, winter/summer and 23/25-hour DST days, actual server inclusive-lower/exclusive-upper window behavior including ongoing events, cost/food/provenance distinctions, detail facts/evidence/actions, absent/unsafe URLs and text, cancellation markup, and selected/encoded detail IDs.
- `node --import tsx --test client/tests/live-step2.test.ts`: both real HTTP integration tests passed through Vite. Verified all 12 filter combinations, sorted published responses, past/cancelled exclusions from the feed, imported/detail records, missing-ID 404, no-match API response, valid/broken flyer routes, and calendar download headers/content with `DTSTART` matching the event's instant.
- `npm run typecheck` and `npm run build`: passed. Repeated after the scroll-navigation fix.
- `git diff --check`: passed at handoff.

**Reproducing the explicit local integration setup:**

1. Ensure port 3001 is available and no real backend is running there. Do not terminate another person's process without coordination. Do not configure `DATABASE_URL` or production mode for this harness; it refuses those settings.
2. In one terminal, run `node --import tsx client/tests/serve-step2-fixtures.ts`. This serves only disposable in-memory fixtures, never activates them in the frontend bundle, and requires no organizer credentials. Optional `--empty` starts an empty store for manual empty-state checks.
3. In a second terminal, run `npm run dev:client -- --port 5174 --strictPort`.
4. Open `http://127.0.0.1:5174` and/or run the explicit live-test command above. The normal `.test.tsx` suite has no running-server dependency. Fixture dates derive from startup time; restart the harness for fresh upcoming records. A fixture without an end time disappears from the upcoming feed once its start passes, as expected.
5. Stop the fixture server when finished. Start the normal app with `npm run dev` to use the actual development backend.

**Browser cases / regression evidence — PASS:**

- Live fixture feed initially showed five events in two Los Angeles date groups. Card ordering, free/$12.50/unknown costs, three food states, organizer confirmation, and distinct USC calendar/EngageSC import labels matched responses. A no-end-time event later aged out after its start, reducing the upcoming count as expected.
- Today, This week, Free, and Food advertised worked alone; Today + Free + Food advertised narrowed the feed to one matching event. Reset restored the unfiltered feed; rapid filter changes settled on the selected state. Resource cancellation/out-of-order behavior remains covered by the foundation tests.
- Opened the selected card and verified details, timestamps, eligibility, organization, food explanation, evidence and uncertainty text, source URL, flyer, and registration target. Back retained the active filter.
- Unknown-details record showed Unknown values and absent-source/flyer messages without a Register action. Broken flyer showed a recoverable image-unavailable message. A nonexistent event showed an unavailable-event state; a cancelled event showed explicit cancellation and no Register action.
- Add to calendar initiated a browser download. Real HTTP tests independently verified the attachment, calendar content, and event instant. External registration/source destination URLs were checked in rendered links; no external form was submitted. Independent calendar-application import remains Step 7.
- Inspected cards, long imported titles, wrapped source URLs, facts, and evidence at 320px. No visible horizontal page overflow; controls remained usable. Phone behavior was emulated, not tested on a physical device.
- Found and fixed scroll carryover: opening a card from a scrolled feed now starts details at the top; Back restores the clicked browsing position. Repeated this exact browser journey after the fix.
- DevTools Offline + Refresh events showed the recoverable network error. Restoring No throttling + Try again recovered successfully. After stopping fixture serving, the available empty development feed showed “No upcoming events yet”; Today displayed the distinct filtered no-match message, and reset restored the empty-feed message.
- Ask, Saved, and Organizer still open their explicitly pending screens; no organizer session UI is implemented yet. Route changes focus the heading. Console observations showed expected errors only for deliberately broken image/missing event/offline requests, with no observed app exception.

**Environment issues / recovery:** sandbox network restrictions initially prevented the Vite/listener and live HTTP checks; reruns outside the sandbox passed. The existing localhost Chrome tab became blank while Vite continued serving HTML. A fresh tab using `127.0.0.1:5174` rendered and supported the checks above. One transient screen-capture failure recovered on the next observation.

**Pending dependencies / limitations:** Save/Unsave controls and persistence remain Step 5 and are intentionally not marked complete in `STEP.md`. Published-deployment verification, full organizer workflows, other browser engines, screen readers, and physical phones remain later-step checks. The server's existing behavior intentionally keeps cancelled event details readable; feed exclusion and the cancellation notice passed. No backend blocker found in this step.

**Completion gate: PASS for the implemented Step 2 scope; Save integration remains pending Step 5.** Stop here; do not begin Step 3 until instructed.

### Step 3 — November 14, 2026

**Scope / environment:** organizer session, draft creation/review/publication, My events editing/cancellation, and refresh of public data after changes. Branch `frontend-stuff`, working-tree changes based on `a21f49c`. Node 22.17.1; real local Express memory backend through Vite at `http://127.0.0.1:5174`; model extraction disabled. Chrome on macOS at desktop width and 320 × 725 responsive emulation. All test uploads, drafts, publications, edits, and cancellations used disposable synthetic data. No server/shared/package implementation, real database, deployment, or submission was changed.

**Automated commands / results — PASS:**

- `node --import tsx --test client/tests/*.test.tsx`: **38 passed, 0 failed**, including all 26 earlier regressions and 12 organizer tests.
- `TZ=Asia/Tokyo node --import tsx --test client/tests/organizer.test.tsx`: **12 passed, 0 failed**.
- `node --import tsx --test client/tests/organizer-live.test.ts`: the real API lifecycle test passed, with assertions covering session restoration, invalid codes, two independent organization cookies, private draft visibility, foreign-owner 403, signed-out 401, missing-record 404, 422 missing-field publication, corrected publication, search visibility, edits, cancellation and public exclusion, image-only/image-plus-text requests, flyer serving, and 204 sign-out cookie clearing. The script refuses to mutate a non-memory or model-enabled backend.
- `npm run typecheck`: passed. `npm run build`: passed, including its typecheck. Final unit suite and build were repeated after the session-network recovery fix.
- `git diff --check`: passed at handoff.
- Inspected client imports and searched the built client for server model-key variable names and the development session secret; no matches. Server authentication/model code is not imported into the app bundle. Demo codes were entered only into the local development sign-in screen, not embedded in client code.

**Unit / render coverage:** money conversions (including 0.29 → 29), invalid/negative/over-precision values, null/zero/false/food distinctions, nullable clears, URL and length validation, end/start ordering, unchanged instant/millisecond preservation, Los Angeles winter/summer round-trips, explicit fall-fold occurrence choice, invalid dates and spring gaps, deadline conversion, allowed MIME types and raw/base64/text limits, data-prefix removal, FileReader success/failure/abort, duplicate-operation prevention, invalidation of late work, stale aborted session errors, changed/expired organization handling, PATCH-before-publish ordering, failed/aborted PATCH blocking publish, save-only behavior, safe evidence/announcement rendering, manual mode, and 422 missing-field markup. Evidence/provenance/warnings are excluded from correction PATCHes because the existing server owns those fields.

**Browser evidence — PASS:**

1. Initial no-session screen showed sign-in. An invalid code showed the server error; `demo-a` opened Demo Org A. Password-manager prompts were dismissed without saving credentials.
2. Created a text draft with a labeled synthetic announcement. Manual extraction fallback, uncertainty notice, and the original announcement were visible.
3. Save and publish on the incomplete draft produced the server's 422 list (`title`, `startsAt`, `location`), associated field messages, and focus on Title. The announcement and editable form remained intact.
4. Entered title, location, Los Angeles start date/time (November 16, 2026, 6:00 PM), and admission 0.29. Saved the draft, reloaded, and resumed it from Private drafts. Session, date/time, location, and amount were restored from the API.
5. Published the resumed draft. My events showed Published; Discover immediately showed the matching event and $0.29. Edited its title, saved, confirmed the updated record, then tested both Keep event and Confirm cancellation. My events showed Cancelled and Discover refreshed to an empty feed.
6. Selected `/private/tmp/trojan-synthetic-flyer.png` through the native file chooser and submitted it with synthetic text. The resulting review displayed the stored flyer and submitted announcement. API integration separately covered image-only requests; unit tests exercised FileReader errors and aborts.
7. At 320px width, inspected the manual-mode/uncertainty notices, review fields and dropdowns, and source display. No visible horizontal page overflow was observed. This was emulation, not a physical phone.
8. Entered an unsaved title, switched DevTools to Offline, and attempted Save draft. Connection/session-check errors appeared while the form and exact title stayed present. Restored No throttling and saved again; Draft saved and the same title appeared in the list. This also checks recovery after a background session-check failure.
9. Signed out with a review open: private form/list state disappeared. Signed into `demo-b`: Demo Org B showed no private drafts or published events from A. A second tab restored B's session; signing out there caused the original tab to show sign-in with its private workspace cleared, verifying cross-tab invalidation.
10. Public lifecycle regressions passed through the real API: drafts never appeared publicly; the new publication was found by the search endpoint; editing updated public details; cancellation removed it from the feed while leaving an explicitly cancelled detail record readable.

**Fixes / rerun evidence:**

- Initial typecheck caught two conditions that tried to render an `unknown` error value directly; converted the conditions to booleans and typechecking passed.
- While reviewing failure recovery, found that transient session-check failures could clear a signed-in workspace. Changed that behavior to preserve the current review on a network failure, with a visible retry message. Explicit 401/organization changes still clear it. The offline → retained edit → successful retry journey above passed after the fix.
- Added session-change/abort checks before private work and a unit regression ensuring a late aborted 401 cannot clear a later organization's session. Authentication mutations suppress overlapping session polling; sign-out clears the current private workspace immediately.
- Sandbox networking initially blocked the real integration run; rerunning the same scoped test outside the sandbox passed.

**Reproduction / remaining limits:**

- Run the normal local API in memory mode without a model key and Vite on port 5174 before the explicit live command. The live script intentionally creates only synthetic records and leaves test drafts/cancelled listings in the disposable memory store; they disappear on backend restart. Do not run it on real organizer data. A local synthetic PNG was created under `/private/tmp` for the native chooser check.
- Cloud extraction quality, its real 5–15 second latency, and a live model-service 503 were **NOT RUN** because no extraction key was configured. Client busy/duplicate/abort logic and structured 503 propagation/save-before-publish failure are covered by deterministic unit tests; actual manual fallback and uploads passed against the server. No model quality or latency claim is made.
- Evidence/uncertainty display used contract-shaped synthetic render fixtures; manual-mode local responses contain no model-generated evidence excerpts. The UI preserves the warnings during edits. The server intentionally clears extraction uncertainties on publication.
- Original pasted text remains available in the current creation/review session. Resumed drafts rely on the flyer, stored description, and evidence available in the existing contract; the server has no original-announcement-text response field.
- A naturally expired signed cookie was not awaited in the browser. Session-401 behavior was checked at the API boundary and in client guard tests; actual sign-out invalidation was verified across tabs. Cross-browser, physical-phone, screen-reader, and deployed-site checks remain later-stage validation.
- Ask UI, saves, and PWA remain Steps 4–6. Successful publication is searchable through the existing backend API; the Ask screen is still explicitly pending.

**Completion gate: PASS for Step 3 frontend and local manual-mode integration.** Automatic model extraction remains an environment-dependent validation limit. Stop here; do not begin Step 4 until instructed.

### Step 4 — November 14, 2026

**Scope / environment:** Ask screen, typed/starter queries, grounded answers/results, error/retry and latest-request handling, detail/back preservation, and invalidation after organizer changes. Branch `frontend-stuff`, uncommitted changes based on `646b0d7`. Node 22.17.1; real local memory API through Vite at `http://127.0.0.1:5174`; server search used its rules fallback with no model configured. Chrome on macOS, desktop and 320 × 725 responsive emulation. No server/shared/package changes, production writes, deployment, or new dependencies.

**Automated verification — PASS:**

- `node --import tsx --test client/tests/*.test.tsx`: **49 passed, 0 failed** (all 38 prior regressions plus 11 new search tests). Repeated after the final status-text/long-loading-message CSS changes.
- `npm run typecheck`: passed. `npm run build`: passed, including typecheck; repeated at handoff.
- `node --import tsx --test client/tests/search-live.test.ts`: real API integration passed. The test refuses non-memory/model-enabled backends, publishes four labeled synthetic records with distinct known/unknown cost/food/suitability, and creates private/cancelled controls. Broad search returned exactly the four published IDs. Individual strict filters excluded the correct unknown record; the combined strict query returned only the fully known eligible event and three exclusion notes. A strict late-night query returned `noMatch` and no results. Private/cancelled controls stayed out of all search responses.
- `git diff --check`: passed at handoff.

**Unit/render coverage:** blank/whitespace rejection and 500/501-character bounds; typed and all starter-prompt request bodies with same-origin credentials; no network request for invalid input; malformed/inconsistent/unpublished response rejection instead of silently modifying membership; success → no-match → failure → exact-query retry; old success arriving after a newer no-match despite ignored abort; cancelled/reset searches ignoring late errors; exact API answer/chips/reasons/exclusion counts and returned detail IDs; honest no-match rendering; escaping of question/model/source text; input labels and maximum length; and no invented initial results. Asynchronous races use controlled promises, not timing sleeps.

**Browser cases — PASS:**

1. Blank submission showed validation and focused the question input. A 500-character meaningful query reached the real API and produced an honest no-match response with the character count at 500/500. Over-limit rejection is covered at the input/validation boundary in unit/render tests.
2. Queried `signaltestfour1794712206366 free events with food for beginners`. One matching synthetic event appeared with the API answer, date/free/food/beginner/topic chips, reason, and separate counts/reasons for unknown cost, unknown food, and unknown beginner suitability.
3. Opened the returned card's exact event ID. Details showed the same event and source section; Tab/Enter on Back returned to Ask with the question and answer intact.
4. Queried the same topic with `free events after 11 pm`. The returned no-match answer and four time exclusions appeared; previous cards were removed. No extra events or relaxed filters were added.
5. Clicked the Free events this week starter prompt. It populated/submitted the question and displayed three matching published events before the cancellation regression below.
6. Inspected the large input, prompts, result cards, long synthetic titles, and match reasons at 320px. Text/controls wrapped without visible horizontal page overflow. This was browser emulation, not a physical phone test.
7. With a successful answer present, set DevTools Offline and submitted again. A connection error and Try again appeared; an accessibility snapshot confirmed the previous answer was absent. Restored No throttling and retried: the same Free events this week query returned three matches. Expected offline request errors appeared in the console; no app exception was observed during these checks.
8. Signed into the local organizer UI and cancelled the disposable fully known matching event. Returning to Ask displayed “Event listings changed” with the question preserved and the old answer removed. Resubmitting returned two current free matches. Discover also refreshed; its Free filter showed two matching events. Signed out after testing.

**Fixture/reproduction notes:** start the normal local memory API without a model key and run Vite on port 5174 before the explicit live-test command. The script creates a unique topic per run, reports it, and retains only labeled synthetic draft/event records in memory for browser verification. Do not run on real organizer data. The recorded topic's fully known record was intentionally cancelled during browser regression; rerun with a fresh topic for the initial one-match scenario. Memory fixtures disappear on backend restart. The standard `.test.tsx` suite requires no running server. Sandbox networking initially blocked the live command; rerunning outside the sandbox passed.

**Remaining limits / dependencies:** Save/Unsave remains Step 5; cards currently link to details and do not claim working saves. Model-backed interpretation/answer quality was **NOT RUN** because no model was configured. The real rules-mode contract and safe display of synthetic model-shaped responses passed separately. Deployed-site, other browser engines, screen-reader, and physical-phone checks remain later-stage validation. Organizer review/publication helpers and Discover/detail regressions passed in the full automated suite; live publication/search and browser cancellation/public refresh also passed. No Step 5 feature work was performed.

**Completion gate: PASS for Step 4; Save integration remains pending Step 5.** Stop here until instructed.

### Step 5 — November 14, 2026

**Scope / environment:** shared saved-ID persistence, Save/Unsave in Discover/Ask/detail/Saved, independent current-record fetching, unavailable/error recovery, and the earlier steps' deferred save controls. Branch `frontend-stuff`, working-tree changes based on `a7f996a`. Node 22.17.1; real local memory backend through Vite on port 5174. Chrome desktop and 320 × 725 responsive emulation. Browser tests used `http://localhost:5174` as a separate storage origin from the earlier `127.0.0.1` tests; the isolated origin initially showed no saved events. No real database, server/shared/package code, browser settings, or deployment was changed.

**Automated commands / results — PASS:**

- `node --import tsx --test client/tests/*.test.tsx`: **63 passed, 0 failed**, including all 49 previous checks and 14 saved-event tests. Existing card/detail/search render tests now supply the same saved-event provider used by the app.
- `npm run typecheck`: passed. `npm run build`: passed, including typecheck. Final checks followed the mixed-record rendering extraction; the final CSS-only removal of an unused placeholder selector was checked with the production build.
- `node --import tsx --test client/tests/saved-live.test.ts`: real API integration passed. Verified public detail refetch after an organizer edit, cancellation retained as an explicitly cancelled saved record, mixed available/private/missing IDs, a controlled 503 at the HTTP boundary followed by real API recovery, and unchanged ID-only persistence through organizer sign-out. The test refuses non-memory/model-enabled backends and mutates only newly created labeled synthetic records.
- `git diff --check`: passed at handoff.

**Unit/render coverage:** empty first use, deduplication, targeted unsave, fresh-store persistence restoration, invalid JSON/wrong shapes/mixed entries, blocked storage access, thrown reads/writes, honest temporary-state notices, write retry merging pending additions/removals with other stored IDs, read recovery retaining hidden existing saves, subscriber synchronization, stable snapshots, external key clearing, 404 versus network/503/abort handling without deleting saved IDs, cancelled/private-status handling, fresh detail requests using `cache: 'no-store'`, independently loaded mixed records, mixed valid/unavailable/error presentation with recovery actions, synchronized card/detail/Ask pressed states, informative empty state, and safe text/cancellation rendering. Only IDs are serialized; event bodies and private organizer data are not stored.

**Browser cases — PASS:**

1. Opened Saved on the isolated localhost origin: no saved events, with instructions for saving from Discover/Ask/detail.
2. Saved the synthetic fixture from Discover and verified detail immediately showed Unsave. Unsave from detail cleared it. Searched the fixture through Ask, saved there, and verified it appeared in Saved.
3. Refreshed the page and opened a new tab at the same origin: the saved ID survived and the event was fetched again. Removed it in Saved; Discover reflected Save again. Tested Save/Unsave in Discover, Save from detail reflected in Ask, and Unsave/Save in Ask. All locations agreed.
4. Inspected Saved and its long synthetic-title card at 320px. The title, facts, View details, and Unsave control wrapped without visible horizontal overflow. This was emulation, not a physical phone.
5. With one saved event present, set DevTools Offline and clicked Refresh saved events. The event showed a connection error with Try again and Remove from saved; its saved ID remained. Restored No throttling and retried: the actual event card returned with Unsave active.
6. Signed into Demo Org A on the isolated origin and edited the saved synthetic event's title. Returning to Saved showed the new title fetched from the API. Cancelled the same disposable event through the confirmation UI; Saved retained it with a clear Cancelled notice and working Unsave. This matches the API's deliberate policy of keeping cancelled details readable.
7. Signed out of Organizer and returned to Saved: the public cancelled listing remained saved, while organizer private views were cleared. Finally removed only the disposable browser save, restoring the origin's original empty list. No pre-existing student saves were removed.

**Negative-case layers / limits:** malformed/blocked/quota storage conditions were exercised with controlled storage implementations and rendered notices, not by changing browser settings. Mixed available/private/missing IDs were checked against the real API and the actual per-record rendering component; no missing-ID storage fixture was injected into the browser. Browser error recovery used a real offline request. Initial attempts to type a read-only storage query in the native developer console were refused by the automation's browser-state guard; no console storage mutation was executed or required for the passing API/render coverage. Console observations showed the expected induced network error and an installed-extension warning, with no observed app exception.

**Reproduction / handoff:** run the normal local API in disposable memory mode without a model key and Vite on 5174 before the explicit live-test command. Its synthetic topic for this run was `savedstepfive1794713083371`; browser fixture ID `96ccb99d-ea2b-4532-a4b6-7e5b40f6360f` was intentionally edited/cancelled during UI checks. The script leaves labeled memory-only records for verification; they disappear on backend restart. Do not use it against real organizer data. The standard `.test.tsx` suite needs no running backend. Sandbox networking initially blocked the live command; rerunning outside the sandbox passed.

**Completion gate: PASS for Step 5.** Earlier Step 2/4 save dependencies are now checked off. Phone/browser/assistive-technology coverage beyond the checks above and the PWA manifest remain Step 6 or later. No Step 6 feature work was performed; stop here until instructed.


## Step 6 run — phone usability, accessibility, and manifest

**Date/state:** 2026-11-14, `frontend-stuff`, uncommitted working tree. Step 6 only; Step 7 remains unstarted.

**Environment:** native Google Chrome on macOS; responsive emulation at 320, 390, 768, and 1280 CSS pixels, plus browser zoom visibly reporting 200%. This was browser emulation, not a physical phone test. Dates remain in Los Angeles time. The compiled client ran against the real API router with disposable synthetic memory records on port 3003. The standard `npm start` server ran separately on port 3002 in local memory mode; this does not establish deployed production readiness.

### Automated checks — PASS

- `npm run build`: typecheck, Vite client build, and server bundle passed after the final changes.
- `node --import tsx --test --test-reporter=spec client/tests/*.test.tsx`: **66 passed, 0 failed**. Includes the earlier date, API, organizer, search, and saved-store regressions; three added checks cover manifest/PNG metadata, measured contrast, and detail-state heading/recovery semantics. Static React rendering does not prove mounted keyboard interactions.
- `PORT=3002 npm start`, then `node --import tsx --test client/tests/production-assets.test.ts`: **1 passed, 0 failed** against the final build. HTML links the manifest; manifest MIME is `application/manifest+json`; all declared icons and the Apple icon return actual PNG bytes at their declared dimensions; compiled JS/CSS and the manifest start URL return the expected resources.
- Manifest: `Trojan Signal` / `Signal`, `/#discover`, scope and ID `/`, standalone display, cardinal theme and cream background. Icons are 192×192, 512×512, maskable 512×512, and Apple 180×180. Pixel inspection confirmed the maskable image is fully opaque and its T sits within the central 80% safe circle. `client/scripts/generate-icons.py` regenerates the existing favicon design with Pillow; no application dependency was added.
- Contrast measured with the WCAG relative-luminance formula: body text on cream **14.54:1**; muted text on the yellow notice background **5.59:1**; cardinal on white **8.92:1**; badge text **6.49:1**. Focus and input boundaries on yellow are **4.64:1** and **3.80:1**. All tested active text pairs exceed 4.5:1 and boundaries exceed 3:1. Disabled controls are visibly disabled; status/food/error meaning also appears in text.
- `git diff --check`: passed.

### Browser/layout checks — observed passes

- Inspected Discover, Ask, Saved, detail, and organizer/review layouts across the required representative widths. Long synthetic titles, a long source URL, lengthy field evidence, and an unbroken evidence token wrapped in the inspected views. Date/time inputs fit at 320px; two-column review fields fit at tablet/desktop widths. No page overflow was observed in the correctly sized previews. During resizing, intermediate accidental tiny viewport values distorted Chrome's emulation; exact sizes were reselected and inspected.
- Links, buttons, filters, form fields, summaries, and the native file selector have minimum 44px target rules; inline links now get the same minimum. Narrow layouts wrap controls without hiding horizontal overflow to conceal problems.
- At 320px, keyboard navigation reached search, submitted a query, and returned a matching long-title card. Saving propagated to Saved. Keyboard Unsave removed the card and focused the Saved heading. The focus ring was visibly present.
- Invalid organizer sign-in returned focus to the access-code field. The field now references its error and reports invalid state. A successful sign-in opened the workspace; opening review focused its heading. Keyboard submission saved a draft. The real API accepted publication of `synthetic-review`; the old preview tab stalled before its final UI completion could be reliably inspected, so that final focus case remains open below.
- Cancellation initially focuses Keep event. Escape dismissed it and restored the Cancel event trigger. Keyboard confirmation cancelled a disposable event. After fixing a list-refresh focus loss, a delayed cancellation at 320px focused the stable Drafts and my events heading while the records reloaded.
- Fixture mode `slow` imposed two-second delays per API request. Session/list loading and eventual completion were observed. Busy review controls were disabled and announced pending work; the existing TaskGate regression also passed its single-flight/late-result checks.
- Fixture mode `error` returned real 503 responses. The app displayed the supplied failure and Try again rather than successful content. At 200% zoom the error text, filters, and retry control remained readable and usable. The final retry after restoring normal responses could not be verified before the browser connection failed.
- Native accessibility trees exposed meaningful labels, headings, navigation links, pressed saved/filter controls, and status/error text. Detail empty/error states now use h2 under the page h1. The announcement preview can receive keyboard focus for scrolling. These observations are not a screen-reader speech test.
- The standard built app opened all five hash destinations, including an unavailable detail ID. HTTP verified the manifest start resource. A complete reload-at-each-hash browser matrix is still pending below.

### Fixes and remaining verification

Implemented focus recovery for navigation, unsaving, review close, completed mutations, and cancellation; associated organizer errors and busy states; expanded tap targets and wrapping; added route-specific document titles and PWA assets. The cancellation focus fix was rechecked successfully. A final adjustment waits until authentication controls are enabled before focusing the sign-in/out result; typecheck/build and automated checks pass, but that final mounted interaction has not been rechecked.

**BLOCKED browser rechecks:** final sign-in/out focus, review close/publish completion and detail/back focus, successful retry after restoring normal responses, and reload at each production hash route. The native browser session developed stalled/inconsistent preview observations; a fresh tab allowed cancellation and zoom checks to continue, then the final action failed with `noWindowsAvailable`. Do not mark these cases passed from static rendering or HTTP alone. Recheck these cases with a working browser before closing Step 6's gate.

**NOT RUN:** screen-reader speech validation (unavailable through this session's tools), an automated accessibility scanner (not configured), physical iOS/Android testing, and app installation. No service worker or offline caching was added; offline support and installability are not claimed.

**Evidence/reproduction:** native browser observations in this session; disposable IDs `synthetic-phone` and `synthetic-review`; `client/tests/serve-step6-fixtures.ts` serves the built app and real API router with explicit `/__fixture/normal`, `/__fixture/slow`, and `/__fixture/error` test switches. It is never imported by the application or production server. No screenshot files were exported. Loopback serving/HTTP needed sandbox escalation. No server, shared-contract, package, or lockfile source changes were made.

**Completion gate: INCOMPLETE — implementation and automated/production-asset checks pass; the listed browser rechecks remain BLOCKED. Stop after Step 6 and await the user's instruction.**


## Step 7 run — integration and acceptance

**Date/state:** 2026-11-14, `frontend-stuff`, base `acaea67`, uncommitted Step 7 working tree. Step 8 was not started. Handoff for Abhishek's notes: [FRONTEND_ACCEPTANCE.md](docs/FRONTEND_ACCEPTANCE.md); it was prepared locally, not sent.

**Environment:** Node 22.17.1, native Chrome on macOS, desktop and 320×725 CSS-pixel emulation. Standard compiled app/API on port 3002; separately seeded disposable memory API plus the same compiled client on port 3003. Existing services on 3001/5174 were preserved. Both test servers reported memory mode with no configured model. No application dependencies, server source, shared contracts, package files, or deployment settings changed.

### Commands and automated results — PASS

For independent parsing in a fresh environment, install the test-only parser with `python3 -m pip install --target /private/tmp/trojan-step7-calendar-parser icalendar==7.3.0`; this is not an application dependency.

- `npm run typecheck`, and final `npm run build`: passed. The build also reruns typecheck. Final client JS: `index-DNKTut9H.js`.
- `node --import tsx --test --test-reporter=spec client/tests/*.test.tsx`: **68 passed, 0 failed**. Two new regressions cover ignoring the current tab's own auth broadcast and explaining unknown-end calendar placeholders while keeping the fact Unknown. Existing date/DST, API/error/stale-response, organizer, search, saved-storage and contrast/manifest/render checks passed.
- `PORT=3002 npm start`, then `FRONTEND_TEST_ORIGIN=http://127.0.0.1:3002 node --import tsx --test --test-concurrency=1 client/tests/organizer-live.test.ts client/tests/search-live.test.ts client/tests/saved-live.test.ts`: **3 passed, 0 failed**, including image and image+text payloads, manual fallback, correction/publication, 401/403/404/422, separate organization cookies, edit/cancel, strict unknown exclusions, no-match and saved-ID refetch/persistence/error isolation.
- `FRONTEND_FIXTURE_PORT=3003 node --import tsx client/tests/serve-step2-fixtures.ts --built-client`, then `FRONTEND_TEST_ORIGIN=http://127.0.0.1:3003 node --import tsx --test --test-concurrency=1 client/tests/live-step2.test.ts client/tests/acceptance-live.test.ts client/tests/production-assets.test.ts`: **4 passed, 0 failed**. This uses the real API router, not intercepted frontend responses. `production-assets.test.ts` deliberately checks the standard server on 3002. All 12 filter combinations, date ordering, seeded imports, private/past/cancelled exclusion, image routes, export headers, full acceptance lifecycle, genuine signed-but-expired cookies, and built manifest/icon/JS/CSS resources passed. The acceptance case was rerun successfully after adding assertions for cancelled exports and the actual unknown-end placeholder.
- `PYTHONPATH=/private/tmp/trojan-step7-calendar-parser python3 client/tests/check-calendar.py`: **6 files passed independent parsing**, including exact start/end instants, Los Angeles winter/summer offsets, before/after midnight, both fall-back occurrences, commas/semicolons/backslashes/newlines, Unicode title text and line folding. The external `icalendar` 7.3.0 package was installed only in that temporary directory, not added to the app. One initial expected-title assertion included a trailing space that the API correctly trims; the expectation was corrected and the case/parser passed again.
- The actual Chrome download `~/Downloads/SYNTHETIC-Step-Seven-Browser-Meetup.ics` was separately parsed with `icalendar`: title/location matched; DTSTART `2026-11-18T02:00:00Z` and DTEND `03:00:00Z` matched the detail display of November 17, 6–7 PM PST.
- `git diff --check`: passed. A scan of `dist/client` found no model/session environment-key names, development session secret, development organizer codes, fixture-control paths, or fixture seed IDs. This was a scoped build inspection, not a comprehensive security audit.

### Browser workflow and regressions — PASS for the observed cases

1. On the built app, signed out and tested an invalid code; the error appeared and focused the code field. Signed in as organization A. Found and fixed self-delivery of BroadcastChannel notifications: the same tab previously cleared/remounted its own auth view. After the fix, sign-in focused the organization heading, sign-out focused the enabled code field, and switching to organization B showed its empty private lists without organization A's records.
2. Created `[SYNTHETIC] Step Seven Browser Meetup` from an announcement/source URL. With no model configured, the UI showed the original text, manual-entry warning and uncertainty; it did not fabricate extraction evidence. Attempting publication before correction returned a real 422 with title/start/location and focused Title. Corrected the title, November 17 start/end (6–7 PM Los Angeles), room and supplied registration URL in the UI, leaving admission/food unknown. Publication succeeded and focused the stable records heading.
3. The event appeared under November 17 in Discover, and Ask returned it with the API's reasons/constraints. Detail preserved Unknown facts. Back restored the Ask query/results and the focused event link. A nonsense query returned a truthful no-match without cards.
4. Save propagated to Saved and persisted across browser reload. Add to calendar initiated a real Chrome download. Register opened the exact supplied synthetic URL in a new tab; no external form was submitted.
5. At 320px, changed the event title through organizer Edit. Saved refetched the updated title. Cancellation defaulted focus to Keep event; Escape returned to its trigger. Keyboard confirmation cancelled it and focused the stable records heading. Saved still showed the cancellation after reload. API checks separately confirmed cancellation disappeared from feed/search.
6. Forced Chrome's tab network to Offline, refreshed Saved, and saw a recoverable connection error with retry/removal controls while the ID stayed saved. Restored No throttling, retried, and the actual cancelled event returned. Restored the normal desktop viewport afterward. This tests failure/recovery, not offline functionality.
7. Restarted only the disposable standard server. The empty Discover feed showed no upcoming events. The previously saved event became a real 404, stayed listed as unavailable, and could be removed; removal focused the Saved heading. This also confirmed there is no automatic fixture population in the standard server.
8. Refreshed each implemented hash destination in the built app: Discover, Ask, Saved, Organizer and event detail. The appropriate screen returned, organization B's session restored, and an unavailable detail used its h2 state with a route back to browsing. Ask's in-memory query resets on a full reload; saved IDs persist independently.
9. Seeded detail pages retained distinct Imported from USC calendar / Imported from EngageSC labels. A missing flyer returned 404 and the image failure message appeared. The final compiled detail explained the one-hour calendar reservation when Ends remained Unknown. Clean imported-detail console inspection showed zero visible console messages, no issues, and one hidden verbose entry; expected negative-case HTTP/disconnection errors are not counted as unexpected app failures. No runtime exception was observed during the recorded successful flow.

**Evidence:** primary browser lifecycle ID `b61a6d8c-1318-46ba-b03f-f0e0adc80b96` (now gone after the deliberate memory reset); final automated acceptance ID `9632987d-aaf5-4c3e-a3e3-cc4ef23beeb3`; synthetic import/image fixtures in `serve-step2-fixtures.ts`; six exports plus `expected.json` in `/private/tmp/trojan-step7-calendar/`; actual Chrome download above. Native browser observations/screenshots were inspected in the session, not exported as Step 8 presentation assets.

### Limits, contract notes, and completion gate

- **BLOCKED — published Replit URL:** the user confirmed no deployment is available yet. No deployment or published-service mutations were attempted. The published core flow, deployed cookies/HTTPS, actual model extraction, Postgres persistence and actual external import remain unverified.
- **NOT RUN — physical phone and speech-based screen reader:** only Chrome phone emulation and its accessibility tree were available. Separate A/B cookie sessions were checked by real HTTP; browser sign-out/sign-in switching was checked, but a dedicated simultaneous two-window browser test was not separately recorded.
- **Backend contract clarification:** shared API comments imply cancelled records are organizer-only; current public detail/calendar deliberately remain readable for saved cancellation notices, while feed/search exclude them. Actual cancelled calendar returns `STATUS:CANCELLED`. Recorded for Abhishek in the handoff, without changing his routes or the contract.
- **Backend calendar policy:** unknown end exports reserve one hour. Verified against the real route; the frontend now states this explicitly and retains Unknown in the Ends field. The desired backend export policy is for Abhishek to confirm.
- **Step 6 follow-up:** this run verified auth completion, publish/edit/cancel completion, detail/back focus, successful retry and the production refresh matrix. Its dedicated Close review button follow-up was not separately rerun, so the historical Step 6 gate is not retroactively marked complete.
- Native automation occasionally returned stale views or rejected coordinate input; the recorded passes above use verified final accessibility/screenshot outcomes, fresh tabs where necessary, and independent HTTP/parse results. Attempted/stale views were not counted as passes.

**Completion gate: local Step 7 core acceptance PASS; overall Step 7 INCOMPLETE/BLOCKED until Replit deployment testing is available.** Test services on 3002/3003 are stopped after verification; existing 3001/5174 services are left alone. Stop here and await instruction before Step 8.
