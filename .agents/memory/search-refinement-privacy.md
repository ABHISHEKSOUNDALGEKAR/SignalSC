---
name: Search refinement privacy
description: Privacy and failure-mode decisions for conversational event search
---

Keep refinement context as structured filters for the current page session, not a saved raw conversation. Send the current follow-up to the approved provider with only that structured context.

**Why:** The user requested context only for the current search session and no default server-side storage of raw conversation text.

**How to apply:** Do not add search-history storage, raw-query logging, or conversation analytics without a separate privacy decision.

If a model cannot resolve a follow-up safely, retain the prior search rather than interpreting the follow-up as a new standalone query. Manual filter edits should not depend on a model response.

**Why:** A phrase such as “next week instead” loses its meaning without the prior constraints; a standalone fallback can silently discard interests or required filters.

**How to apply:** Disclose the failed update, leave the current constraints unchanged, and let the student retry or edit the filters.
