---
name: AI spending limit scope
description: Safety boundary for AI admission limits and future scaling
---

Treat the model admission gate as per-process request protection, not a hard financial ceiling. Count failed outbound attempts as spent; never refund them merely because a response failed validation.

**Why:** The provider may charge for requests that time out or return unusable responses. Multiple replicas and restarts defeat an in-memory aggregate spending ceiling.

**How to apply:** Preserve fail-fast admission for every provider call. Before claiming a persistent application-wide spending ceiling, coordinate counters across replicas and restarts, or use provider billing limits. Keep tests simulated unless the user explicitly approves paid verification.
