import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { playwrightInjectedPlugin } from "./build/playwrightInjectedPlugin.ts";

export default defineConfig({
  plugins: [playwrightInjectedPlugin()],
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    include: ["src/**/*.test.ts"],
  },
});
