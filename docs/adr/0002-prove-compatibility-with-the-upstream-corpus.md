---
status: accepted
---

# Prove compatibility with the unchanged upstream corpus

Compatibility is proven by running Playwright's own specs, copied byte-for-byte from a pinned commit, through the browser adapter. A corpus test counts as proof only once it is a reviewed baseline entry. We chose this over writing our own compatibility tests because upstream specs state Playwright's behaviour without our interpretation of it. Review is required because an upstream test can pass without the adapter executing the method it asserts.

The package's own contract tests cover only what the corpus cannot reach: adapter-specific behaviour and Playwright behaviour no upstream spec exercises. Neither kind is a unit test; internal modules are not tested directly.
