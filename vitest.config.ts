import type { IncomingMessage, ServerResponse } from "node:http";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { playwrightInjectedPlugin } from "./build/playwrightInjectedPlugin.ts";

/** A 1×1 transparent GIF. */
const pixel = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * `/__delay?ms=<n>&type=image|text` answers after `n` milliseconds, so a
 * contract test can hold real traffic in flight for a known time.
 */
function delayedResponsePlugin() {
  return {
    name: "playwright-lite-contract-delay",
    configureServer(server: {
      middlewares: {
        use(
          path: string,
          handle: (request: IncomingMessage, response: ServerResponse) => void
        ): void;
      };
    }) {
      server.middlewares.use("/__delay", (request, response) => {
        const query = new URL(request.url ?? "", "http://localhost")
          .searchParams;
        const image = query.get("type") === "image";
        setTimeout(
          () => {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader(
              "Content-Type",
              image ? "image/gif" : "text/plain"
            );
            response.end(image ? pixel : "delayed");
          },
          Number(query.get("ms") ?? 0)
        );
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
