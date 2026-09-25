import js from "@eslint/js";
import tseslint from "typescript-eslint";

import { pageGlobalNames } from "./build/playwrightInjectedPlugin.ts";

// The page globals the adapter keeps (`virtual:playwright-lite-globals`): a
// page script can delete or replace the global of the same name, so `src/`
// imports each one from that module instead of reading the page's.
const pageGlobals = pageGlobalNames();

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...pageGlobals.map((name) => ({
          name,
          message: `Import ${name} from "virtual:playwright-lite-globals"; the page can delete or replace its global.`,
        })),
      ],
    },
  },
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
