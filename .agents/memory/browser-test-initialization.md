---
name: Browser test initialization
description: Keep Playwright startup mocks independent of Node-side transpilation helpers.
---

Playwright startup scripts must be self-contained browser JavaScript. When a mock declares named functions or classes, prefer a raw JavaScript `content` script over a serialized TypeScript callback.

**Why:** The project's tsx runner can add naming helpers to declarations inside callbacks. Those helpers exist in Node but not in the browser; the startup script then stops partway through, leaving the real browser API active and making the mock appear to have installed successfully.

**How to apply:** For browser API mocks, avoid captured Node values and transpiler-generated helpers. Assert that the mock is installed before relying on its captured results; surface page initialization errors when investigating failures.
