---
name: Firefox mobile test limits
description: Limits of mobile-device emulation in the Linux Playwright Firefox browser
---

Playwright's Linux Firefox build did not expose `navigator.maxTouchPoints` when launched with a narrow viewport and `hasTouch: true`. It can still exercise Firefox/Gecko page lifecycle behavior at a mobile-sized viewport, but that is not equivalent to native mobile touch behavior or iOS Safari.

**Why:** A browser regression check confirmed the Firefox context remained usable for unload and confirmation-dialog tests, but the touch-capability assertion failed.

**How to apply:** Describe Linux Firefox checks as engine tests at a mobile-sized viewport. Use a real mobile browser or a WebKit-capable environment before claiming iOS Safari or native touch verification.
