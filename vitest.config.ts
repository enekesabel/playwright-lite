import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

import { playwrightInjectedPlugin } from "./build/playwrightInjectedPlugin.ts";

/** A 1×1 transparent GIF. */
const pixel = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * `/__delay/<ms>/<name>` answers with a GIF after `ms` milliseconds, so a
 * contract test can hold real traffic in flight for a known time.
 */
function delayedResponsePlugin(): Plugin {
  return {
    name: "playwright-lite-contract-delay",
    configureServer(server) {
      server.middlewares.use("/__delay", (request, response) => {
        const ms = Number(request.url?.split("/")[1] ?? 0);
        setTimeout(() => {
          response.setHeader("Content-Type", "image/gif");
          response.end(pixel);
        }, ms);
      });
    },
  };
}

/**
 * `/__repeated-header` answers with `x-repeated` sent twice, so a contract test
 * can see how the browser shows a repeated response header to the document.
 */
function repeatedHeaderPlugin(): Plugin {
  return {
    name: "playwright-lite-contract-repeated-header",
    configureServer(server) {
      server.middlewares.use("/__repeated-header", (_, response) => {
        response.setHeader("x-repeated", ["one", "two"]);
        response.end("done");
      });
    },
  };
}

export default defineConfig({
  plugins: [
    playwrightInjectedPlugin(),
    delayedResponsePlugin(),
    repeatedHeaderPlugin(),
  ],
  // The screenshot renderer is served as published, so the injected plugin
  // binds its builtins the way the package build does. It has no imports, so
  // the first capture's lazy import discovers no dependency to optimize and
  // Vite does not reload the page.
  optimizeDeps: { exclude: ["@zumer/snapdom"] },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    include: ["src/**/*.test.ts", "tests/contract/**/*.test.ts"],
  },
});
