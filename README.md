# playwright-lite

Playwright-compatible `Page` and `Locator` operations for the browser document you're already in.

Use the same Playwright-typed page objects in a browser application, without a browser process or remote automation connection. The runtime bundles the selector, accessibility, and element-state implementation generated from stock Playwright 1.62.1.

This is an independent project, not an official Microsoft package. The first release is in preparation.

## Usage

```ts
import { createPage } from "@enekesabel/playwright-lite";

const page = createPage({
  testIdAttribute: "data-test",
  actionTimeout: 5_000,
  navigationTimeout: 10_000,
});

await page.getByTestId("name").fill("Ada");
await page.getByRole("button", { name: "Save" }).click();
```

All options are optional. `createPage()` uses `data-testid`, a 1,000 ms action timeout, and a 30,000 ms navigation timeout. Set a timeout to `0` to disable it. Existing `page.setDefaultTimeout()` and `page.setDefaultNavigationTimeout()` methods remain available.

Each Page owns its configuration. Creating another Page does not change the test-ID attribute of existing pages or locators. The library does not load `playwright.config.ts` or require a framework plugin.

Page objects can continue importing `Page` and `Locator` as types from `@playwright/test`. The tested type peer is Playwright 1.62.1. Playwright's Node runtime is not included in the browser bundle.

The package exports only `createPage` and the `CreatePageOptions` type. Use `page.ariaSnapshot()` or `locator.ariaSnapshot()` for accessibility snapshots. Implementation classes, locator brands, and DOM resolvers are not public.

## Scope

The runtime controls the current window and document. Supported behavior includes locator queries and composition, browser-side input and pointer actions, synthetic keyboard input, element handles, waits, and accessibility snapshots.

Playwright's types describe more capabilities than a script inside a document can provide. Browser launch, browser contexts, other document realms, and browser-process operations are outside the current scope. Keyboard events are synthetic, not trusted input. Native editing defaults such as cursor movement, deletion, and focus traversal are not fully implemented.

Compatibility checks run selected, unchanged Playwright tests through this runtime. The reviewed passing baseline is enforced; unsupported diagnostic tests are not advertised as supported behavior. See `tests/upstream/baseline.json` for reviewed cases and `AGENTS.md` for the promotion rules.

## Development

Installing and bundling the package supports Node.js 20 or newer. This is separate from the contributor environment.

Use Devbox for development. `devbox.json` selects Node.js 24 and enables Corepack; `devbox.lock` pins the environment, and `packageManager` pins pnpm 11.24.0.

```sh
devbox shell
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm check
```

`pnpm check` builds the package, checks linting and types, runs unit and browser compatibility tests, verifies an isolated packed consumer, and checks formatting.

The generated injected script is committed and hash-checked during builds. Consumers do not generate it. Maintainers can reproduce it with `pnpm generate:check`. `pnpm generate:injected` regenerates it using the exact official revision in `tests/upstream/corpus.ts` and Playwright's own generator. Review artifact hash changes before updating the build pin. `pnpm upstream:sync` copies the selected tests from that same revision.

CI runs the development checks on Node.js 24.12.0 with Chromium on Ubuntu. A separate Node.js 20.0.0 job installs the same tarball with engine checks enabled, compiles a consumer POM, and runs it in Chromium without repository development dependencies or a separately installed YAML package. CI does not publish packages. The package is configured for GitHub Packages; `pnpm pack` creates a local tarball for installation before publication.

## License

MIT for this project. Bundled and copied third-party code retains its own license. See `THIRD_PARTY_NOTICES.txt` and `LICENSES`.
