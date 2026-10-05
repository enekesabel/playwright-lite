import { afterEach, describe, it } from "vitest";

import { hiddenTabCases } from "../hidden-tab";

afterEach(() => {
  document.body.innerHTML = "";
});

// Vitest's tab is always visible, so this run proves the cases themselves
// hold in a foreground tab. `pnpm test:hidden-tab` runs the same table in a
// hidden one.
describe("hidden-tab", () => {
  it.each(hiddenTabCases)(
    "%s behaves as in a foreground tab",
    async (_apiName, run) => {
      await run();
    }
  );
});
