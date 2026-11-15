# Live AI verification

Verified on November 15, 2026, using the user's approved BluesMinds account.
No keys or provider response bodies are recorded here.

## Configuration

- Endpoint: `https://api.bluesminds.com/v1`
- Model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`
- Key: securely configured as `MODEL_API_KEY`
- Mode: documented `chat_template_kwargs.enable_thinking: false`; default
  reasoning can consume the app's small JSON output budgets.
- Model discovery authenticated successfully. The listed
  `meta/llama-3.2-11b-vision-instruct` returned HTTP 410 and was not used.

## Previously recorded real-provider checks

Command: `npm run test:ai:live -- --confirm-live`

The baseline was run on November 15, 2026:

All eight real JSON completions passed. Requests flowed through
`server/model.ts`, with actual `server/extract.ts` and `server/search.ts`
logic. The script observed network responses without replacing them and
required complete JSON responses; a search fallback could not count as success.

## Expanded opt-in evaluation

The command requires the exact approved BluesMinds endpoint and model in
`MODEL_BASE_URL` and `MODEL_NAME`, plus the approved key in `MODEL_API_KEY`.
The `--confirm-live` flag is explicit consent to spend provider credits.
Requests flow through `server/model.ts`, with actual `server/extract.ts` and
`server/search.ts` logic. The script observes network responses without
replacing them and requires complete JSON responses; a search fallback cannot
count as success.

The new cases below are included in the runner but were not sent to the
provider while this change was being made. Running the command above spends
credits and executes the expanded evaluation.

| Check | Acceptance criteria |
| --- | --- |
| Announcement text | Printed event facts are extracted with source evidence. |
| Sparse text | Missing date, location, cost, eligibility, suitability, registration, and end time stay unknown. |
| Clear image only | The PNG is read without announcement text; unprinted fields remain unknown. |
| Conflicting dates | Ambiguous event start stays unknown and is flagged; evidence excerpts must occur in the synthetic source. |
| Incomplete registration link | Partial URL remains unknown and is flagged instead of completed or guessed. |
| Embedded instructions | Text asking the model to invent event facts does not supply those facts. |
| Blurry flyer | Clear title is retained while blurred date, time, and location remain unknown and are flagged. |
| Crowded flyer | Two equally prominent event listings with different dates, times, and locations are not combined. |
| Constrained search | Interpretation applies free, advertised food, beginner-friendly, tonight, and after-5 PM constraints; only the eligible record reaches the answer call. |
| Excluded records | Paid, unknown cost, no/unknown food, unknown beginner suitability, early, future-day, past, cancelled, and draft fixtures do not appear. |
| Answer with unknown facts | Astronomy answer does not invent admission price, location, eligibility, or beginner suitability. |
| No matches | Unknown cost does not satisfy “free”; empty results do not trigger model answer generation. |

Extraction fixtures are synthetic and non-sensitive. Search was exercised
through the real API router on an isolated ephemeral HTTP server, with a memory
store seeded by synthetic fixtures. No public events were created, and no
application database or real organizer session was used. These live checks are
opt-in only and must not be added to automatic validation.

An initial live extraction inferred “USC students only” without source support.
The extraction prompt now explicitly forbids that inference; attendance
restrictions also require quoted source evidence (checked against the source
for text-only input). Regression tests cover unsupported and supported claims.

## Limits

These checks are a small live-provider evaluation, not universal model accuracy.
Organizers must still review extracted facts before publishing. This is not a
browser organizer-login test or a production deployment verification.
Synthetic edge cases do not cover every real-world flyer. Availability and
model access may change with the provider.
`/api/health` reports configuration presence, not a provider availability probe.
