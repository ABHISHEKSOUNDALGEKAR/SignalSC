---
name: AI spending limit scope
description: Safety boundary for AI admission limits and future scaling
---

Treat the model admission gate as per-process request protection, not a hard financial ceiling. Count failed outbound attempts as spent; never refund them merely because a response failed validation.

**Why:** The provider may charge for requests that time out or return unusable responses. Multiple replicas and restarts defeat an in-memory aggregate spending ceiling.

**How to apply:** Preserve fail-fast admission for every provider call. Before claiming a persistent application-wide spending ceiling, coordinate counters across replicas and restarts, or use provider billing limits. Keep tests simulated unless the user explicitly approves paid verification.

Every retry that sends another provider request must reserve another request-budget attempt before sending. It can share the logical request's existing concurrency slot.

**Why:** A retry can incur a separate provider charge even though it is part of one logical model operation.

**How to apply:** Add a request-budget reservation before each retry, while avoiding a second concurrency reservation for an already-active logical request.
