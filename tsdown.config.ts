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
  plugins: [playwrightInjectedPlugin()],
});
