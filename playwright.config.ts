import { defineConfig, devices } from "@playwright/test";

// `sabotagedMethod` names one adapter method to withhold from the browser
// adapter. It is never set here: the promotion rerun in
// scripts/upstream-baseline.mjs generates a configuration that imports this one
// and fills the option in with a literal, so the switch travels in that
// generated file and not in the environment, which a spec could write to.
export default defineConfig<{ sabotagedMethod?: string }>({
  testDir: "./tests/upstream",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
