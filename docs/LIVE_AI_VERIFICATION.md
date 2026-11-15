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
Before running it, obtain explicit approval from the account owner for this
expanded run, explaining that it sends synthetic flyer pixels and text to
BluesMinds and spends credits. Existing provider setup approval is not consent
to run new evaluations. Only after approval, run
`npm run test:ai:live -- --confirm-live` manually. Never set this flag in CI,
automatic validation, build scripts, or post-merge hooks.
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
| Conflicting image and announcement date | A matching event title does not make either source authoritative; the start stays unknown and the disagreement is flagged. |
| Conflicting image and announcement venue | The date remains available, but the disputed location stays unknown and the disagreement is flagged. |
| Sideways flyer | A fully visible flyer rotated 90° retains “Orbit Sketch Night”, November 22, 2026 at 8:15 PM Pacific, and TCC 450; unprinted fields stay unknown. |
| Low-light flyer | The illuminated “Lantern Poetry Circle” title is retained, but shadowed date, time, and venue stay unknown and unreadability/poor lighting is flagged. Evidence may quote only the readable title. |
| Spanish text and image separately | November 24, 2026, 18:30–20:00 Pacific, TCC 450, and `7,50 USD` → 750 cents. Club-members-only attendance and required experience are retained; “no food” does not become advertised food. |
| French text and image separately | “25 ou 26 novembre 2026” / “Date à confirmer” does not become a guessed date. Start and end stay unknown despite a printed 19:15 start time; Leavey Library is retained and the date conflict is flagged. Unprinted cost, suitability, and attendance remain unknown. |
| German text and image separately | November 27, 2026 at 18:45 Pacific, free admission, and no prior knowledge required are retained. The unannounced location stays unknown with a venue warning; unprinted end time and attendance remain unknown. |
| Constrained search | Interpretation applies free, advertised food, beginner-friendly, tonight, and after-5 PM constraints; only the eligible record reaches the answer call. |
| Excluded records | Paid, unknown cost, no/unknown food, unknown beginner suitability, early, future-day, past, cancelled, and draft fixtures do not appear. |
| Answer with unknown facts | Astronomy answer does not invent admission price, location, eligibility, or beginner suitability. |
| No matches | Unknown cost does not satisfy “free”; empty results do not trigger model answer generation. |

Extraction fixtures are synthetic and non-sensitive. Search was exercised
through the real API router on an isolated ephemeral HTTP server, with a memory
store seeded by synthetic fixtures. No public events were created, and no
application database or real organizer session was used. These live checks are
opt-in only and must not be added to automatic validation.

### Rotated and low-light fixtures

`tests/fixtures/live-flyer-rotated.svg` and
`tests/fixtures/live-flyer-low-light.svg` are editable synthetic originals.
Their checked-in PNGs are the actual image-only provider inputs; neither SVG
text nor expected answers are sent with them. The low-light original contains
November 23, 2026, 9:45 PM Pacific, and Doheny Library, but these are deliberately
near-black on near-black. Even a correct guess at those hidden facts fails:
the safe result is an unknown date and venue with a warning.

`scripts/live-flyer-cases.ts` holds these expectations and assertions, shared
with `tests/ai-live-evaluation.test.ts`. The ordinary `npm run test:ai` checks
that bad answers fail those assertions, the PNGs exist, and the live runner
refuses to start without its consent flag. `tests/ai-configured.test.ts` also
stubs the model response to prove that a reported date or location disagreement
clears that field, removes its evidence, and adds a confirmation warning even
if the model also returned a selected value. If a multimodal response omits the
source-comparison result, date, time, and location are withheld rather than
assuming the sources agree. These offline checks do **not** establish that
BluesMinds detects disagreements in the images. The new provider calls have
not been run as part of these changes. With the multilingual cases below,
a full successful expanded run now makes 23 JSON completions
(18 extractions and 5 search completions), with
no retries; it stops at the first failure, so credit usage can be lower.

`live-flyer-conflicting-date.svg` and `live-flyer-conflicting-venue.svg` are
editable synthetic originals; their paired PNGs are sent alongside
contradictory synthetic announcement text. The date case disagrees only about
the event date, while the venue case disagrees only about the location. The
live acceptance helper requires the disputed field to remain unknown and an
image-versus-announcement warning to be present. Live checks remain opt-in:
the explicit `--confirm-live` flag is required, and the account owner must
approve spending for each expanded evaluation.

To regenerate the small PNG fixtures locally with ImageMagick and DejaVu Sans:

```sh
convert -background none tests/fixtures/live-flyer-rotated.svg -strip PNG24:tests/fixtures/live-flyer-rotated.png
convert -background none tests/fixtures/live-flyer-low-light.svg -strip PNG24:tests/fixtures/live-flyer-low-light.png
```

### Multilingual reference fixtures

`tests/fixtures/multilingual-flyers.ts` contains three non-sensitive, invented
flyer transcripts with line-aligned English reference translations and exact
expected facts. The reference pairs were checked line by line for equivalence:
month names and date alternatives, 24-hour time, decimal-comma USD pricing,
negation, and membership/experience requirements. These are authored evaluation
references, not certified translations or a claim of independent native-speaker
review. All dates have an explicit year; language does not change the app's
America/Los_Angeles campus timezone. USD is explicit so the test does not assume
currency conversion.

Each `live-flyer-{spanish,french,german}.svg` prints precisely that language's
source lines; its checked-in PNG is the image input. The French flyer deliberately
does not specify which of two dates applies. The German flyer explicitly says
the location will be announced later. Unknowns must stay unknown even if a
plausible answer could be guessed.

The runner sends each original-language transcript and each PNG in **separate**
extraction calls (six new completions). It never sends English translations,
expected answers, SVG markup, or image transcripts alongside pixels. Both modes
use `scripts/multilingual-flyer-cases.ts` for the same strict assertions:
dates/times, venues, prices, suitability, attendance, missing registration,
no invented food, relevant uncertainty notes, and original-language evidence.
Eligibility may retain the original wording or its literal reference translation;
evidence must still quote the original. For the French case, the draft cannot
represent a time without a date, so retaining a guessed full timestamp fails.

`tests/ai-multilingual-evaluation.test.ts` checks fixture/transcript alignment
and deliberately mutated wrong answers without calling a model. Run it with
`npm run test:ai`. Passing it verifies the evaluation's guardrails, **not**
multilingual provider accuracy. None of these six new live calls was run during
this change: no new credit-spending consent was requested or assumed. The same
account-owner consent and manual `--confirm-live` gate described above apply;
do not include the live command in automatic checks.

Regenerate the three small PNGs with ImageMagick and DejaVu Sans:

```sh
for lang in spanish french german; do
  convert -background none "tests/fixtures/live-flyer-$lang.svg" -strip "PNG24:tests/fixtures/live-flyer-$lang.png"
done
```

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
