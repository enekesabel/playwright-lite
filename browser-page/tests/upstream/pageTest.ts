/**
 * Package-local replacement for Playwright's tests/page/pageTest.ts.
 *
 * Routes all Page/Locator calls through the actual
 * @ayme-dev/playwright-browser createPage adapter running in the browser.
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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAdapterPage,
  installTestIdAttributeSynchronization,
} from "./adapter-bridge";
import { TestServer } from "./testServer";

const __fixtureDir = dirname(fileURLToPath(import.meta.url));

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

export const test = base.extend<
  ServerFixtures & PlatformFixtures & CompatFixtures & AdapterTimeoutFixtures
>({
  actionTimeout: [undefined, { option: true, box: true }],
  navigationTimeout: [undefined, { option: true, box: true }],
  // ── Adapter page ──────────────────────────────────────────────────
  // Wraps the real Playwright page with a proxy that routes all
  // compatibility operations through the in-browser adapter.
  page: async (
    { page, playwright, actionTimeout, navigationTimeout },
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
      });
      await use(proxyPage);
    } finally {
      await resetTestIdAttribute();
      const evidence = await page
        .evaluate(() => (window as any).__aymeEvidence)
        .catch(() => null);
      if (evidence) {
        evidence.failures = (page as any).__aymeTransportFailures;
        evidence.native = (page as any).__aymeNativeOperations;
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
  browserMajorVersion: async ({}, use) => {
    const version = process.env.PLAYWRIGHT_BROWSER_VERSION ?? "0";
    await use(parseInt(version, 10));
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
