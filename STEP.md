# Davis frontend contribution: steps, agent instructions, and definition of done

## Purpose and ownership

Build the student-facing and organizer-facing frontend for Trojan Signal. Davis owns all client screens, styling, phone layouts, local saves, the PWA manifest, and presentation assets: slide deck, screenshots, and video editing.

Source documents:

- `docs/WORK_SPLIT.md`: ownership, required screens, and checkpoints.
- `shared/api.ts`: authoritative API request and response contract.
- `shared/events.ts`: event fields, validation, and unknown-value semantics.
- `tests.md`: required per-step tests, regression selection, and verification reports. Follow the matching test gate before marking a step complete.
- `README.md` and `docs/BUILD_PLAN.md`: product context and acceptance checks. Some starter-status descriptions predate the server implementation; inspect current code before relying on them.

Abhishek owns `server/`: authentication, authorization, Postgres, flyer extraction and storage, search interpretation and filtering, calendar generation, feed import, and Replit deployment. Davis builds the UI that consumes these services and participates in integration checks.

## Instructions for the implementing agent

1. Read this file, the source documents above, and any applicable `AGENTS.md` before changing code. Inspect current files and git status; preserve existing work.
2. Work on the user's existing frontend branch. At the time this checklist was created, that branch was `frontend-stuff`; the work split calls the role's branch `client`. Do not rename or switch branches merely to match that document.
3. Keep implementation primarily within `client/`. Organize screens, reusable components, API helpers, and date/storage utilities into focused files instead of expanding one large component.
4. Use the existing React, TypeScript, Vite, and CSS setup. Prefer existing dependencies and native browser capabilities. Coordinate package changes: only one teammate edits `package.json` / `package-lock.json` per checkpoint.
5. Notify the other teammate before changing `shared/api.ts` or `shared/events.ts`. If a mismatch blocks work, record the exact request, response, or field involved and coordinate a fix. Do not silently change the server contract to fit the frontend.
6. Use relative `/api/...` URLs. Development proxies to port 3001, and production serves the client and API together. Keep cookie sessions with same-origin credentials; keep model keys and secrets on the server.
7. Use types from `shared/api.ts` for API consumers. Replace the starter's older `EventListResponse` usage with `EventsResponse`. Check HTTP status before treating responses as success, and preserve error bodies, especially publication `missing` fields.
8. If an endpoint is unavailable, use explicitly labeled, contract-shaped development fixtures to continue UI work. Keep fixtures isolated and removable. Never silently fall back to synthetic events after a live request fails, and never claim mock integration is complete.
9. Preserve truthfulness: null means unknown; zero cost means free; unknown cost is not free. Food has three distinct states. Never infer eligibility, beginner suitability, dates, years, dietary suitability, or organizer confirmation from missing information.
10. Use `America/Los_Angeles` for event displays, date grouping, and Today/This week boundaries, regardless of the browser timezone. Send offset-bearing ISO timestamps. Handle daylight saving correctly; do not append a fixed UTC offset to local form values. Request clarification for ambiguous or nonexistent local times rather than silently shifting them.
11. Render source text and model output as ordinary text. Avoid injecting raw HTML. Offer actionable validation and retry states without exposing stack traces, credentials, or internal implementation details to users.
12. Complete work in the order below, prioritizing the upload → review → publish → discover/Ask flow. Keep checklist status accurate; mark tasks done only after the listed behavior is verified. Document blockers without marking blocked work complete.
13. Verify relevant behavior after meaningful changes. Run `npm run typecheck` and `npm run build` before handoff. Add focused automated tests where useful for date boundaries, storage behavior, and critical transformations; avoid tests that merely repeat UI implementation.
14. Report files changed, verified behavior, commands and outcomes, remaining blockers, and any teammate coordination needed. Do not claim browser checks, live deployment checks, recordings, or presentation assets that were not completed.
15. Do not merge, deploy, submit Devpost, or message teammates unless the user has authorized those actions. Prepare reviewable changes and record the required handoff. Never discard unrelated changes or commit secrets.

## Starting state

At checklist creation, `client/src/main.tsx` contained a styled introductory shell, Discover/Organizer navigation buttons, and an events request displaying only a status/count. The functional screens below were not implemented. Reinspect before starting because work may have progressed.

## Step 1 — Establish the frontend foundation

- [x] Set up navigation for Ask, Discover, event detail, Saved, and Organizer.
- [x] Preserve the Trojan Signal identity while creating consistent spacing, typography, colors, buttons, inputs, cards, and status messaging.
- [x] Add typed API helpers for JSON requests and structured errors, including 401 and 422 handling.
- [x] Add shared event-card, field-display, loading, empty-state, and error/retry components as needed.
- [x] Prevent stale responses from overwriting newer filters/searches; clean up pending requests when appropriate.
- [x] Ensure navigating into details and back preserves a usable browsing experience.

**Done when:** every required area is reachable, the existing app still builds, API errors can be displayed, and reusable UI foundations work at phone and desktop sizes.

**Step 1 completed:** see the November 14, 2026 run in `tests.md`. All destinations have navigation shells; the Discover connection check uses the real API. The other screens explicitly identify pending work. Event cards have a reusable foundation but are not yet a rendered event feed. Cleanup/race protection is available for future filters/searches; those features remain in their assigned later steps. Stopped here awaiting the user's instruction.

## Step 2 — Discover and event details

### Discover

- [x] Load published, upcoming events through `GET /api/events` using `EventsResponse`.
- [x] Render useful event cards grouped by Los Angeles date and ordered by start time.
- [x] Add Today, This week, Free, and Food advertised filter chips using `from`, `to`, `free=1`, and `food=1` query parameters as applicable.
- [x] Make active filters clear, support combining/resetting filters, and define the This week range consistently in the UI.
- [x] Show initial loading, empty feed, no matches under filters, request failure, and retry states.

### Event details

- [x] Fetch details with `GET /api/events/:id` and handle unavailable/deleted/cancelled records gracefully.
- [x] Present title, description, start/end time, timezone, location, eligibility, cost, food, beginner suitability, registration deadline, organization, and relevant publication/update information.
- [x] Display absent facts as “Unknown”; show food as “Advertised,” “Not advertised,” or “Unknown.” Explain that “Not advertised” does not promise that no food exists.
- [x] Display evidence/uncertainties where relevant and preserve the event's source information.
- [x] Label `organizer-confirmed` as organizer-confirmed. Label `source-imported` according to its actual source, such as Imported from EngageSC; an import must never appear organizer-confirmed.
- [x] Display the flyer when present, with appropriate alternative text and an image-failure state. Offer the original source link when present; indicate when it is unknown.
- [x] Add a plain anchor to `/api/events/:id/calendar.ics` for Add to calendar.
- [x] Show Register only when `registrationUrl` exists, and link to that URL.
- [ ] Connect Save/Unsave to the shared saved-event state from Step 5.

**Done when:** real API events can be filtered, opened, and inspected; unknown values and provenance stay accurate; source, registration, and calendar actions point to the correct resources.

**Step 2 implementation and verification:** see the Step 2 run in `tests.md`. Discover and details use the real API; synthetic local test records are isolated in an explicit fixture server. Today/This week show upcoming and ongoing events, with Monday–Sunday weeks in Los Angeles time. The current server intentionally permits direct reads of cancelled events; details label them cancelled and suppress the Register action. Save/Unsave remains unchecked until Step 5; no working Save control is claimed. No Step 3 work started. Stopped here awaiting the user's instruction.

## Step 3 — Complete the organizer workflow

### Session and draft creation

- [x] Restore the session through `GET /api/organizer/session`; treat 401 as signed out.
- [x] Sign in with `{ accessCode }` through `POST /api/organizer/session`; show the organization and useful invalid-code errors.
- [x] Sign out with `DELETE /api/organizer/session` and clear private client state. If a session expires, require sign-in and do not leave private screens populated for another organization.
- [x] Accept flyer files or pasted announcement text, with an optional source URL.
- [x] Validate against the current shared request schema: supported image formats, required input, text limits, and the base64 length limit. Explain invalid inputs before submission.
- [x] Convert an image to base64 without the `data:` prefix, include its supported `mimeType`, and submit `CreateDraftRequest` to `POST /api/organizer/drafts`.
- [x] Show honest progress/busy messaging during the expected 5–15 second extraction. Prevent duplicate submissions and provide recovery on failure.
- [x] Support manual review/entry when the response reports `extractedBy: 'manual'`; extraction availability must not prevent correcting the draft.
- [x] List and reopen existing private drafts using `GET /api/organizer/drafts`.

### Review and publication

- [x] Build an editable form for all relevant `EventDraft` fields, including explicit unknown options for nullable and three-state values.
- [x] Show the flyer or submitted text alongside the review when available. Show `evidence` excerpts beside their corresponding fields and make `uncertainties` prominent; show unmatched uncertainty messages in a general review area.
- [x] Preserve evidence and provenance during edits. Do not invent evidence or erase warnings merely because a field was focused.
- [x] Convert dollar amounts to integer `costCents` accurately; preserve the distinction between blank/unknown and zero/free.
- [x] Convert event times between Los Angeles form values and offset-bearing ISO timestamps correctly, including registration deadlines.
- [x] Save corrections with `PATCH /api/organizer/drafts/:id`. Persist the latest edits successfully before publishing.
- [x] Publish with `POST /api/organizer/drafts/:id/publish`.
- [x] On 422, display the server's `missing` fields clearly, associate them with form controls where possible, and retain the user's edits.
- [x] On success, show the published result and refresh relevant client data so it appears in Discover and can be found through Ask.

### My events

- [x] Load the organization's events with `GET /api/organizer/events`, including cancelled records.
- [x] Edit using `PATCH /api/organizer/events/:id` and `UpdateEventRequest`.
- [x] Provide a clear cancel action using `{ cancelled: true }`, prevent accidental activation, and display the resulting cancelled status.
- [x] Refresh affected views after edit/cancel. Handle 401/403/404 errors without pretending the operation succeeded.

**Done when:** an organizer can sign in, create or resume a draft, inspect evidence, correct unknowns, publish, edit, cancel, and sign out. A second organization does not see the first organization's cached private data. Server permission failures remain visible and cannot be bypassed by UI state.

**Step 3 completed:** see the Step 3 run in `tests.md`. Organizer sessions, image/text drafts, review, save-before-publish, My events, editing, cancellation, and public-feed refresh are implemented. Browser and real local API checks used disposable synthetic memory records. The API search check finds published records; the Ask screen remains Step 4. Automatic model extraction was not configured locally, so real upload/manual fallback and contract-shaped evidence rendering were verified separately. Original pasted text is available during the current creation/review; the API does not provide an original-text field when resuming a draft. No Step 4 work started. Stopped here awaiting the user’s instruction.

## Step 4 — Ask

- [x] Build a large question input with useful starter prompts and a submit action. Respect the shared query length limit and reject blank input.
- [x] Send `{ query }` to `POST /api/search`.
- [x] Display the returned `answer`, `constraintSummary` chips, each result's event card and `reason`, and `excluded` reasons/counts.
- [x] When `noMatch` is true, clearly show the returned no-match answer without fabricated suggestions presented as matching events.
- [x] Keep returned result membership and match explanations grounded in the response. Do not generate additional client-side AI claims or silently relax the server's constraints.
- [x] Connect result cards to event details and support loading, error/retry, and repeated searches.
- [ ] Connect Ask result Save/Unsave controls to the shared saved-event state when Step 5 is implemented.

**Done when:** a natural-language question returns the API's grounded answer and results, while a strict no-match query gives an honest empty outcome with relevant exclusion notes.

**Step 4 implementation and verification:** see the Step 4 run in `tests.md`. Ask uses the real search endpoint, preserves the question/results when returning from details, and clears old answers on a new request or an organizer event change. Controlled asynchronous tests verify stale-response protection. Local rules-mode API and browser checks passed for matches, unknown-value exclusions, no-match, error/retry, and the query limit. Save integration stays unchecked for Step 5. No Step 5 work started. Stopped here awaiting the user's instruction.

## Step 5 — Saved events

- [ ] Store a deduplicated list of event IDs in a namespaced `localStorage` key; share save state across cards, details, and the Saved screen.
- [ ] Refetch current records through `GET /api/events/:id` rather than treating stored copies as current.
- [ ] Support save, unsave, refresh persistence, and an informative empty state.
- [ ] Handle malformed stored data or unavailable storage without crashing or falsely claiming persistence.
- [ ] Handle a saved event that is no longer available without breaking the remaining list; distinguish unavailable events from temporary network failures.

**Done when:** saves survive a page refresh, all save controls agree, and stale records or storage failures produce understandable behavior.

## Step 6 — Phone usability, accessibility, and PWA manifest

- [ ] Check all screens at narrow phone widths, tablet widths, and desktop widths. Include long titles, URLs, and evidence excerpts; eliminate horizontal scrolling.
- [ ] Provide at least 44px tap targets, visible focus, readable contrast, semantic buttons/links, explicit form labels, and accessible status/error messages.
- [ ] Verify keyboard navigation, focus handling after navigation/dialogs, and appropriate busy/disabled states.
- [ ] Include loading, empty, error, and retry/recovery behavior in every data-dependent flow; never leave a failed action looking successful.
- [ ] Add a linked web app manifest with app names, suitable icons, start URL, display mode, theme color, and background color. Put public assets where Vite includes them in the build, such as `client/public/`.
- [ ] Verify the manifest and icons load in the production build. A manifest does not establish offline support or universal installability; report only behavior actually verified. Offline caching and service workers are outside the assigned manifest requirement unless separately agreed.

**Done when:** the complete workflow is usable with touch and keyboard, layouts remain readable without horizontal overflow, and production serves a valid manifest and its assets.

## Step 7 — Integration and acceptance checks

- [ ] Run `npm run typecheck` and `npm run build`, and resolve failures caused by frontend work. Record unrelated failures separately if they block verification.
- [ ] Verify against the real backend: organizer sign-in → flyer/text → review → correction → publish → Discover → Ask → detail → save → calendar/registration action.
- [ ] Repeat the core flow on the published URL with Abhishek when deployment is available; local success alone does not complete this check.
- [ ] Test invalid access codes, expired sessions, unavailable API, empty feeds, a no-match query, a 422 publication response, missing images, and unavailable saved events.
- [ ] Verify missing cost does not display as free, unknown food stays unknown, missing facts are not invented, and imported records retain their actual provenance.
- [ ] Check date grouping and filters near Los Angeles midnight and a daylight saving boundary; verify the displayed time agrees with the server's calendar export.
- [ ] Verify organizer edit/cancel updates the student experience. Confirm drafts and cancelled events are absent from applicable public API results; report backend violations to Abhishek rather than merely hiding them visually.
- [ ] Use the two development organizations to check session switching and permission-error handling. Local development codes are `demo-a` and `demo-b`; do not advertise them as production credentials.
- [ ] Record actual checks, outcomes, and remaining issues for Abhishek's test notes. Never invent test metrics or claim checks that were not run.

**Done when:** required commands pass, the real end-to-end workflow is demonstrated, and critical failures have either been fixed or explicitly recorded as blockers. A mocked-only implementation is not integration-complete.

## Step 8 — Slides, screenshots, and video

- [ ] Coordinate with Abhishek's demo script; he owns the script, test notes, and Devpost text.
- [ ] Create a slide deck covering the missed-event problem, intended users, flyer → reviewed event → grounded discovery flow, working demo, actual validation, limitations, and next steps.
- [ ] Capture readable screenshots of the implemented Ask, Discover, detail, Saved, and organizer review experiences, including a phone layout.
- [ ] Record the working product after feature freeze and edit the demo video to show the core flow, evidence/unknowns, a truthful no-match, and save/calendar actions.
- [ ] Label synthetic fixtures as synthetic. Do not invent organizer quotes, usage metrics, partnerships, or testing outcomes, and keep credentials/private information out of captures.
- [ ] Deliver the deck, screenshots, and playable video in an agreed location; record file paths or links and verify they open. Confirm delivery format and video constraints against the team's submission requirements.

**Done when:** the team has reviewable slides, usable screenshots, and a playable edited video that accurately represent the working product and are ready for the submission owner.

## Checkpoints and priorities

The work split lists a final deadline of **Sunday, November 15, 2026, at 11:00 AM Pacific**. It gives these checkpoint times; use them as the team's schedule and confirm any revised timing together.

| Checkpoint | Davis's deliverable |
| --- | --- |
| 9:00 PM | Client displays real events from the deployed API; coordinate with Abhishek on deployment readiness. |
| Midnight | Flyer → review → publish → found through Ask works on the published URL. |
| 8:30 AM | Feature freeze; begin final recording and capture screenshots. |
| 10:30 AM | Presentation assets delivered and frontend blockers reported so the team can submit Devpost with both teammates. |

Prioritize the working core flow before optional polish. The manifest remains part of Davis's assigned work; offline support, student accounts, email digests, calendar synchronization, and additional recommendation features are not required by this checklist.

## Overall definition of done

Davis's contribution is complete only when:

- [ ] All five functional areas—Ask, Discover, event detail, Saved, and Organizer—meet their step-level definitions of done.
- [ ] The actual API powers the required flows, including organizer edit/cancel, structured errors, truthful unknowns, provenance, saves, and calendar/registration actions.
- [ ] Mobile usability, accessibility checks, and the PWA manifest are complete.
- [ ] Typechecking and production build pass, real integration checks are recorded, and the core flow has been checked on the published URL.
- [ ] Slide deck, screenshots, and edited video are delivered and verified.
- [ ] Shared-contract or dependency changes are coordinated, and the frontend changes are ready for the agreed merge checkpoint without unrelated edits or secrets.
- [ ] The handoff states what was implemented, what was tested, asset locations, and any remaining limitations. Any unmet required item remains explicitly incomplete rather than being counted as done.
