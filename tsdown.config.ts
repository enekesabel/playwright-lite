import { defineConfig } from "tsdown";

import { playwrightInjectedPlugin } from "./build/playwrightInjectedPlugin.ts";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  deps: {
    alwaysBundle: [/[/\\]yaml[/\\]/],
    neverBundle: ["@playwright/test"],
  },
  format: ["esm"],
  // The package runs in browsers, so package.json declares no Node engine for tsdown to derive a target from.
  target: "es2023",
  plugins: [playwrightInjectedPlugin()],
});
