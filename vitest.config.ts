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

export default defineConfig({
  plugins: [playwrightInjectedPlugin(), delayedResponsePlugin()],
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
