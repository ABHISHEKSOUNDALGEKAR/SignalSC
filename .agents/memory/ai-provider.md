---
name: AI provider approval
description: Provider consent and lessons from live AI verification
---

The user explicitly approved switching from OpenAI directly to BluesMinds,
including routing flyer content and search questions through that service.
Do not silently change to a different provider.

**Why:** The replacement key was issued by BluesMinds, not OpenAI. The user
chose the switch after being told about data routing and credit usage.

**How to apply:** Preserve that provider choice unless the user requests a
change. Match credentials to the approved endpoint without printing them.
Check current model access and actual completions: an authenticated models
listing does not guarantee a listed model is usable.

Keep credit-spending live checks opt-in and separate from simulated-provider
regressions. Use synthetic inputs and an isolated store, never create public
verification events.

**Why:** Simulated responses cannot establish provider compatibility, and
provider defaults can consume a short structured-output budget before a JSON
answer is produced.

**How to apply:** Require actual complete JSON responses and ensure search
fallbacks do not count as successful live verification. Never log model
reasoning, credential values, or raw provider error bodies.
