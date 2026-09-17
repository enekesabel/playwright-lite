# Context

Glossary of terms used in this repository.

- **Contract tests** — the package's own tests. They drive the public API in a
  browser and live under `tests/contract/`.
- **Corpus** — the unchanged upstream Playwright specs under `tests/upstream/`,
  run against this package. A corpus test counts as proof of a behaviour only
  once it is a reviewed baseline entry.
- **Unit test** — reserved for a test that targets an internal module directly.
  Contract tests and corpus tests are not unit tests.
