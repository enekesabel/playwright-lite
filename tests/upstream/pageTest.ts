/**
 * Package-local replacement for Playwright's tests/page/pageTest.ts.
 *
 * Routes all Page/Locator calls through the actual
 * @enekesabel/playwright-lite createPage adapter running in the browser.
 * No calls fall back to the real Playwright driver.
 *
 * Upstream spec files import { test, expect } from './pageTest' unchanged.
 */
import {
  test as base,
  expect as baseExpect,
  type Page,
  type Frame,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAdapterPage,
  installTestIdAttributeSynchronization,
} from "./adapter-bridge";
import { specNames } from "./corpus";
import { stableTestId } from "./stableTestId";
import { TestServer } from "./testServer";

const __fixtureDir = dirname(fileURLToPath(import.meta.url));

// ── Known corpus failures ───────────────────────────────────────────

const corpusFiles = new Set<string>(specNames);
const reviewedIds = new Set<string>(
  JSON.parse(
    readFileSync(resolve(__fixtureDir, "baseline.json"), "utf8")
  ).reviewed.map((entry: { id: string }) => entry.id)
);

/**
 * Corpus tests outside the reviewed baseline are expected to fail. Marking
 * them keeps Playwright from restarting the worker after an ordinary failure
 * (a timeout still counts as unexpected and restarts it). The report still
 * records the observed status, so baseline:check can surface newly passing
 * tests.
 */
export function isKnownFailure(titlePath: readonly string[]): boolean {
  const [file = "", ...titles] = titlePath;
  return (
    corpusFiles.has(basename(file)) &&
    !reviewedIds.has(stableTestId(file, titles))
  );
}

// ── Native setup navigation ─────────────────────────────────────────

/**
 * Specs that establish their test document or origin with `page.goto` before
 * exercising the member they assert. In this package's single-document
 * adapter that navigation replaces the document the adapter lives in, so the
 * setup call destroys the execution context and the test dies before reaching
 * its subject. These files run `page.goto` on the native Playwright driver
 * instead.
 *
 * Being listed here only enables setup navigation: the bridge stops using the
 * native driver at the test's first adapter call, so a `goto` issued after
 * that routes through the adapter like any other member and fails there.
 *
 * The native call is recorded as `Page.goto` native evidence, so it can never
 * certify navigation compatibility, and it is never a fallback for a failed
 * browser-adapter action. Everything each spec asserts still executes through
 * the browser adapter. Specs whose subject is navigation itself
 * (`page-goto.spec.ts`) are deliberately absent.
 */
const nativeNavigationForSetupSpecs = new Set([
  "elementhandle-bounding-box.spec.ts",
  "elementhandle-click.spec.ts",
  "elementhandle-convenience.spec.ts",
  "elementhandle-misc.spec.ts",
  "elementhandle-query-selector.spec.ts",
  "elementhandle-scroll-into-view.spec.ts",
  "elementhandle-select-text.spec.ts",
  "elementhandle-wait-for-element-state.spec.ts",
  "eval-on-selector.spec.ts",
  "expect-boolean.spec.ts",
  "expect-matcher-result.spec.ts",
  "expect-misc.spec.ts",
  "locator-click.spec.ts",
  "locator-convenience.spec.ts",
  "locator-element-handle.spec.ts",
  "locator-misc-1.spec.ts",
  "locator-misc-2.spec.ts",
  "locator-query.spec.ts",
  "matchers.misc.spec.ts",
  "page-add-locator-handler.spec.ts",
  "page-add-script-tag.spec.ts",
  "page-add-style-tag.spec.ts",
  "page-aria-snapshot.spec.ts",
  "page-autowaiting-no-hang.spec.ts",
  "page-basic.spec.ts",
  "page-click-react.spec.ts",
  "page-click-scroll.spec.ts",
  "page-click-timeout-1.spec.ts",
  "page-click-timeout-2.spec.ts",
  "page-click-timeout-3.spec.ts",
  "page-click-timeout-4.spec.ts",
  "page-click.spec.ts",
  "page-dispatchevent.spec.ts",
  "page-drag.spec.ts",
  "page-evaluate.spec.ts",
  "page-filechooser.spec.ts",
  "page-fill.spec.ts",
  "page-history.spec.ts",
  "page-keyboard.spec.ts",
  "page-localstorage.spec.ts",
  "page-mouse.spec.ts",
  "page-select-option.spec.ts",
  "page-set-input-files.spec.ts",
  "page-wait-for-function.spec.ts",
  "page-wait-for-load-state.spec.ts",
  "page-wait-for-selector-1.spec.ts",
  "page-wait-for-selector-2.spec.ts",
  "page-wait-for-url.spec.ts",
  "queryselector.spec.ts",
  "selectors-css.spec.ts",
  "selectors-misc.spec.ts",
  "selectors-text.spec.ts",
  "wheel.spec.ts",
]);

// ── Fixtures ────────────────────────────────────────────────────────

type ServerFixtures = {
  server: TestServer;
  httpsServer: TestServer;
  asset: (relativePath: string) => string;
};

type PlatformFixtures = {
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  platform: "win32" | "linux" | "darwin";
  loopback: string;
};

type CompatFixtures = {
  browserMajorVersion: number;
  mode: string;
  isAndroid: boolean;
  isElectron: boolean;
  isBidi: boolean;
  electronMajorVersion: number;
  nodeVersion: { major: number; minor: number; patch: number };
  isHeadlessShell: boolean;
  isFrozenWebkit: boolean;
  headless: boolean;
  toImpl: (object: unknown) => unknown;
};

// Playwright's built-in option fixtures default both values to 0, which loses
// the distinction between an omitted value and an explicit `test.use({
// actionTimeout: 0 })`. The adapter must preserve its own browser defaults
// when the setting is omitted, so this local fixture keeps that distinction
// while still receiving normal Playwright Test `use` overrides.
type AdapterTimeoutFixtures = {
  actionTimeout: number | undefined;
  navigationTimeout: number | undefined;
};

type KnownFailureFixtures = {
  knownFailure: void;
};

// Adapter method the promotion rerun withholds from the browser adapter. Its
// value comes from the configuration that rerun generates and runs with; no
// other run supplies it.
type SabotageFixtures = {
  sabotagedMethod: string | undefined;
};

export const test = base.extend<
  ServerFixtures &
    PlatformFixtures &
    CompatFixtures &
    AdapterTimeoutFixtures &
    KnownFailureFixtures &
    SabotageFixtures
>({
  actionTimeout: [undefined, { option: true, box: true }],
  navigationTimeout: [undefined, { option: true, box: true }],
  sabotagedMethod: [undefined, { option: true, box: true }],
  knownFailure: [
    async ({}, use, testInfo) => {
      if (isKnownFailure(testInfo.titlePath)) testInfo.fail();
      await use();
    },
    { auto: true, box: true },
  ],
  // ── Adapter page ──────────────────────────────────────────────────
  // Wraps the real Playwright page with a proxy that routes all
  // compatibility operations through the in-browser adapter.
  page: async (
    { page, playwright, actionTimeout, navigationTimeout, sabotagedMethod },
    use,
    testInfo
  ) => {
    const configuredTestIdAttribute = (
      testInfo.project.use as { testIdAttribute?: unknown }
    ).testIdAttribute;
    const resetTestIdAttribute = await installTestIdAttributeSynchronization(
      page,
      playwright,
      typeof configuredTestIdAttribute === "string"
        ? configuredTestIdAttribute
        : undefined
    );
    try {
      const proxyPage = await createAdapterPage(page, {
        actionTimeout,
        navigationTimeout,
        sabotagedMethod,
        nativeNavigationForSetup: nativeNavigationForSetupSpecs.has(
          basename(testInfo.file)
        ),
      });
      await use(proxyPage);
    } finally {
      await resetTestIdAttribute();
      const evidence = await page
        .evaluate(() => (window as any).__pwLiteEvidence)
        .catch(() => null);
      if (evidence) {
        evidence.failures = (page as any).__pwLiteTransportFailures;
        evidence.native = (page as any).__pwLiteNativeOperations;
      }
      testInfo.annotations.push({
        type: "adapter-execution",
        description: JSON.stringify(evidence),
      });
    }
  },

  // ── Test server ───────────────────────────────────────────────────
  server: async ({}, use) => {
    const server = await TestServer.create();
    await use(server);
    await server.close();
  },

  httpsServer: async ({}, use) => {
    const server = await TestServer.createHTTPS();
    await use(server);
    await server.close();
  },

  asset: async ({}, use) => {
    const assetsDir = resolve(__fixtureDir, "../assets");
    await use((relativePath: string) => resolve(assetsDir, relativePath));
  },

  // ── Platform info ─────────────────────────────────────────────────
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
  isMac: process.platform === "darwin",
  platform: process.platform as "win32" | "linux" | "darwin",
  loopback: "localhost",

  // ── Compatibility stubs ───────────────────────────────────────────
  browserMajorVersion: async ({ browser }, use) => {
    await use(parseInt(browser.version(), 10));
  },
  mode: "default",
  isAndroid: false,
  isElectron: false,
  isBidi: false,
  electronMajorVersion: 0,
  nodeVersion: async ({}, use) => {
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    await use({ major, minor, patch });
  },
  isHeadlessShell: false,
  isFrozenWebkit: false,
  headless: true,
  toImpl: async ({}, use) => {
    await use((obj: unknown) => obj);
  },
});

// ── Expect ──────────────────────────────────────────────────────────

export const expect = baseExpect.extend({
  toContainYaml(received: string, expected: string) {
    const trimmed = expected.split("\n").filter((a) => !!a.trim());
    const maxPrefixLength = Math.min(
      ...trimmed.map((line) => (line.match(/^\s*/) ?? [""])[0].length)
    );
    const trimmedExpected = trimmed
      .map((line) => line.substring(maxPrefixLength))
      .join("\n");
    try {
      if (this.isNot) expect(received).not.toContain(trimmedExpected);
      else expect(received).toContain(trimmedExpected);
      return { pass: !this.isNot, message: () => "" };
    } catch (e: unknown) {
      return {
        pass: this.isNot,
        message: () => (e instanceof Error ? e.message : String(e)),
      };
    }
  },
});

// ── Utilities ───────────────────────────────────────────────────────

export async function rafraf(target: Page | Frame, count = 1) {
  for (let i = 0; i < count; i++) {
    await target.evaluate(
      async () =>
        new Promise((f) =>
          requestAnimationFrame(() => requestAnimationFrame(f))
        )
    );
  }
}
