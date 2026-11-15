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

## Real-provider checks

Command: `npm run test:ai:live -- --confirm-live`

All eight real JSON completions passed. Requests flowed through
`server/model.ts`, with actual `server/extract.ts` and `server/search.ts`
logic. The script observes network responses without replacing them and
requires complete JSON responses; a search fallback cannot count as success.

| Check | Result |
| --- | --- |
| Announcement text | Extracted title, date, start/end, location, cost, food, beginner suitability, explicit attendance eligibility, and registration URL with evidence. |
| Sparse text | Missing dates, location, cost, eligibility, suitability, registration, and end time remained unknown. |
| Image only | Read the real PNG fixture with no announcement text: “Signals Study Jam,” November 20, 2026, 7 PM, Leavey Library. Unprinted fields remained unknown. |
| Constrained search | Live model interpretation correctly applied free, food advertised, beginner-friendly, tonight, and after 5 PM constraints. Only the eligible record reached the real answer call. |
| Excluded records | Paid, unknown cost, no/unknown food, unknown beginner suitability, early, future-day, past, cancelled, and draft fixtures did not appear. |
| Answer with unknown facts | Astronomy answer did not invent admission price, location, attendance eligibility, or beginner suitability. |
| No matches | Unknown cost did not satisfy free; empty results did not trigger model answer generation. |

Search was exercised through the real API router on an isolated ephemeral
HTTP server, with a memory store seeded by synthetic fixtures. No public events
were created, and no application database or real organizer session was used.

An initial live extraction inferred “USC students only” without source support.
The extraction prompt now explicitly forbids that inference; attendance
restrictions also require quoted source evidence (checked against the source
for text-only input). Regression tests cover unsupported and supported claims.

## Limits

These checks verify basic live-provider behavior, not universal model accuracy.
Organizers must still review extracted facts before publishing. This is not a
browser organizer-login test or a production deployment verification.
Crowded, blurry, adversarial, and multi-event real-world flyers need a broader
evaluation set. Availability and model access may change with the provider.
`/api/health` reports configuration presence, not a provider availability probe.
