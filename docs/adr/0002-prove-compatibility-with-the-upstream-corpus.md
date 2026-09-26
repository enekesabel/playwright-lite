---
status: accepted
---

# Prove compatibility with the unchanged upstream corpus

Compatibility is proven by running Playwright's own specs, copied byte-for-byte from a pinned commit, through the browser adapter. A corpus test counts as proof only once it is a reviewed baseline entry. We chose this over writing our own compatibility tests because upstream specs state Playwright's behaviour without our interpretation of it. Review is required because an upstream test can pass without the adapter executing the method it asserts.

The package's own contract tests cover only what the corpus cannot reach: adapter-specific behaviour and Playwright behaviour no upstream spec exercises. Neither kind is a unit test; internal modules are not tested directly.

## Amendment: what the bridge may answer or transform (#172)

A corpus result is promotable only if the adapter produced it, and promotion sees from the execution evidence when it did not, rather than relying on each reviewer to notice.

- **Native setup list.** Out-of-scope members still run on the native driver, so tests that mix them with in-scope members stay diagnostic. The bridge records each such call, and each member called on what one returns, in the evidence's `native` log. Promotion refuses a test whose `native` log holds any member outside a fixed setup list, wherever in the test it ran, and `baseline:check` counts such a reviewed entry as a regression. A native member belongs to the list only when its native call can never be the subject of a promotion and it serves to establish the document under test: `Page.goto` (a native `goto` is refused as a reviewed method), the out-of-scope `Page.setContent` and `Page.setViewportSize`, and the library-fixture plumbing that creates and disposes the page under test, `Browser.newContext`, `BrowserContext.newPage` and `BrowserContext.close`. Anything else recorded natively refuses promotion.
- **Members answered in Node.** `Page.url()`, `Locator.toString()` and `Locator.description()` are synchronous in Playwright's API, while the test's calls reach the adapter asynchronously, so the bridge answers them in Node: `url()` replays the adapter's latest answer, and the locator members are answered by the pinned client's own Locator for the same chain, which formats its selector with the isomorphic functions the adapter mirrors; a guard pins those answers to the adapter's. The evidence records each call in `answeredInNode`, and promotion refuses a test whose reviewed method is recorded there. This is a standing exception: reviewed contract tests prove these three members, not the corpus.
- **Serializer-equivalent rewriting is transport.** The bridge may rewrite an argument or result only as the pinned protocol serializer does (a `Map` crosses as `{}`, a method shorthand is normalized as the pinned server normalizes a page function), so the adapter receives what it would receive from Playwright's client. Any other rewriting is not transport and must be recorded in the evidence like a Node answer.
- **Never promotable.** Transport artefacts — the user activation the driver's evaluation carries, its exemption from the page's CSP for `eval`, and CDP error and stack text — and callbacks that must run in Node (`exposeFunction`, event handlers) describe the harness, not a consumer, who has no Node side. Tests asserting them stay diagnostic permanently; review refuses them, since the evidence cannot show them.
