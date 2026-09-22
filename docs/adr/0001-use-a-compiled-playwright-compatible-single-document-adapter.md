---
status: accepted
---

# Use a compiled Playwright-compatible single-document adapter

Playwright's public `Page` and `Locator` types are the compatibility interface. A compiled in-browser adapter controls the current `Window` and document, so browser-side page objects can reuse those types without a parallel compatibility model.

`createPage()` returns Playwright's own `Page` type, unchanged. Members the adapter does not support still exist on the type and fail at runtime, as the README documents; they are never removed or narrowed in the declarations. A script that type-checks against Playwright type-checks against this package. Subset types the adapter fills (such as `Request` and `Response`) may be exported for consumers who opt in, but no exported type replaces or intersects a Playwright type on `createPage()`'s return.

The adapter reuses pinned Playwright browser primitives for selector parsing and querying, accessibility, element state, actionability, and locator expectations. Its Page and Locator implementations orchestrate operations and browser-side input and events. This seam excludes browser-process operations, other pages, and other document realms until deliberately added.
