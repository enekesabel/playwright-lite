---
status: accepted
---

# Use a compiled Playwright-compatible single-document adapter

Playwright's public `Page` and `Locator` types are the compatibility interface. A compiled in-browser adapter controls the current `Window` and document, so browser-side page objects can reuse those types without a parallel compatibility model.

The adapter reuses pinned Playwright browser primitives for selector parsing and querying, accessibility, element state, actionability, and locator expectations. Its Page and Locator implementations orchestrate operations and browser-side input and events. This seam excludes browser-process operations, other pages, and other document realms until deliberately added.
