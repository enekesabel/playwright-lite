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
        // Native navigation establishes the document only. It is recorded and
        // cannot certify navigation or replace a failed browser-adapter action.
        nativeNavigationForSetup: [
          "page-localstorage.spec.ts",
          "page-click.spec.ts",
          "elementhandle-click.spec.ts",
          "page-click-scroll.spec.ts",
          "page-click-timeout-1.spec.ts",
          "page-click-timeout-2.spec.ts",
          "page-click-timeout-3.spec.ts",
          "page-click-timeout-4.spec.ts",
        ].some((name) => testInfo.file.endsWith(`/${name}`)),
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
