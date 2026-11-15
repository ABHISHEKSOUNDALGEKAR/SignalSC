# Frontend test plan and step completion gates

Use this document with `STEP.md`. It defines the checks the implementing agent must perform after each step and the evidence needed before marking that step complete. This is a test plan, not a claim that tests exist or have passed.

## Agent instructions

1. Before implementing a step, read its test section below and identify the affected existing behavior. After implementing it, run the relevant checks and regressions before marking its `STEP.md` checklist complete.
2. Use automated unit tests for important logic: date boundaries, money conversion, request/error handling, form serialization, and saved-ID storage. Use component/integration tests for consequential interactions and browser checks for layout, navigation, focus, downloads, and real API flows.
3. Test observable behavior and outcomes. Avoid assertions tied to component internals, CSS class names, incidental wording, or large snapshots. Do not add unit tests for presentation-only changes when browser verification is sufficient.
4. Inspect current tooling before adding dependencies. At creation of this plan, `package.json` has no test script or test runner. Do not claim `npm test` works. If needed, add a small compatible test setup and document its actual commands, coordinating package/lockfile changes under `STEP.md`. Keep test files within the frontend ownership area where practical.
5. Keep fixtures synthetic, labeled, deterministic, and shaped like the current shared API contract. Mock the network boundary for isolated tests; use the real server for integration acceptance. A mock passing is not evidence that an endpoint works.
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

- Unit: **Not configured yet.**
- Component/integration: **Not configured yet.**
- Browser automation: **Not configured yet; manual browser checks are acceptable when recorded.**

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
- [ ] Edit a saved event through Organizer and confirm Saved shows current data after refetch; cancel it and verify graceful unavailability.
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

No application tests have been run as part of creating this plan. Add implementation-step reports here as work progresses.
