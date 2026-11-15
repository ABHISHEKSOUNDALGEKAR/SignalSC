---
name: AI spending limit scope
description: Safety boundary for AI admission limits and future scaling
---

Treat model admission as request-attempt protection, not a hard financial ceiling. Count failed outbound attempts as spent; never refund them merely because a response failed validation.

**Why:** The provider may charge for requests that time out or return unusable responses, and may continue processing after a client crash or timeout. Multiple replicas and restarts defeat in-memory aggregate limits.

**How to apply:** Preserve fail-fast, database-coordinated admission for every provider call. Never fall back to local counters after a coordination failure. Keep all replicas on the same limits and database, and use provider billing limits for financial ceilings. Keep tests simulated unless the user explicitly approves paid verification.

Every retry that sends another provider request must reserve another request-budget attempt before sending. It can share the logical request's existing concurrency slot.

**Why:** A retry can incur a separate provider charge even though it is part of one logical model operation.

**How to apply:** Add a request-budget reservation before each retry, while avoiding a second concurrency reservation for an already-active logical request.

For cache-fill crashes, distinguish unattempted work from possibly charged work: expire ownership promptly but retain the retry cooldown once an outbound attempt could have happened.

**Why:** Expiring ownership alone would let a restarted importer pay again for a request whose result was lost. Treating every claim as spent would unnecessarily defer work rejected before provider admission.

**How to apply:** Fence cache writes by ownership and expiry. Mark possible spending immediately before sending, after admission. A crash in the narrow mark-before-send interval is conservatively treated as potentially charged.
