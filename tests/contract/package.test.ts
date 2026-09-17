import { afterEach, describe, expect, it } from "vitest";

import { createPage, type CreatePageOptions } from "../../src/index";
import * as publicExports from "../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("public browser entry", () => {
  it("exports only the page factory at runtime", () => {
    expect(Object.keys(publicExports)).toEqual(["createPage"]);
  });
  it("captures an ordinary accessibility snapshot", async () => {
    document.body.innerHTML = "<h1>Settings</h1><button>Save</button>";
    const snapshot = await createPage().ariaSnapshot();
    expect(snapshot).toContain('heading "Settings" [level=1]');
    expect(snapshot).toContain('button "Save"');
  });

  it("accepts omitted and zero timeouts", () => {
    expect(() =>
      createPage({ actionTimeout: undefined, navigationTimeout: undefined })
    ).not.toThrow();
    expect(() =>
      createPage({ actionTimeout: 0, navigationTimeout: 0 })
    ).not.toThrow();
  });

  it.each(["actionTimeout", "navigationTimeout"] as const)(
    "rejects invalid %s values",
    (name) => {
      for (const value of [-1, NaN, Infinity, "5", null]) {
        expect(() =>
          createPage({ [name]: value } as CreatePageOptions)
        ).toThrow(`${name} must be a finite, non-negative number.`);
      }
    }
  );

  it("rejects invalid test-ID attributes", () => {
    for (const testIdAttribute of ["", " ", null, 5]) {
      expect(() =>
        createPage({ testIdAttribute } as CreatePageOptions)
      ).toThrow("testIdAttribute must be a non-empty string.");
    }
  });

  it("createPage uses the current window without an alternate-window option", () => {
    const page = createPage();
    expect(page).toBeDefined();
    expect(page.locator("body")).toBeDefined();
  });

  it("applies configured defaults to the page returned by createPage", async () => {
    document.body.innerHTML = "";
    const page = createPage({ actionTimeout: 5 });
    await expect(page.locator("#missing").click()).rejects.toThrow(
      "Timeout 5ms exceeded"
    );
  });

  it("page does not expose resolveOne", () => {
    const page = createPage();
    expect((page as unknown as Record<string, unknown>).resolveOne).toBe(
      undefined
    );
  });
});
