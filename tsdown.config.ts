import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

import { playwrightInjectedPlugin } from "./build/playwrightInjectedPlugin.ts";

export default defineConfig({
  alias: {
    chalk: fileURLToPath(new URL("./src/chalkBrowser.ts", import.meta.url)),
  },
  clean: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // The whole tsconfig program, so src/virtual-modules.d.ts declares
  // `virtual:playwright-lite-globals` and the declarations drop its imports,
  // which only bind values.
  dts: { eager: true },
  entry: ["src/index.ts"],
  deps: {
    alwaysBundle: [
      /[/\\]@jest[/\\]expect-utils[/\\]/,
      /[/\\]jest-matcher-utils[/\\]/,
      /[/\\]yaml[/\\]/,
    ],
    neverBundle: ["@playwright/test"],
  },
  format: ["esm"],
  // The package runs in browsers, so package.json declares no Node engine for tsdown to derive a target from.
  target: "es2023",
  plugins: [playwrightInjectedPlugin()],
});
