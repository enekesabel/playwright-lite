import { afterEach, describe, expect, it } from "vitest";
import { createPage, type CreatePageOptions } from "./index";
import * as publicExports from "./index";

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

  it("keeps the default test-ID attribute", async () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';
    expect(await createPage().getByTestId("save").count()).toBe(1);
  });

  it("uses custom test IDs for Page and chained Locator queries", async () => {
    document.body.innerHTML =
      '<section data-test="panel"><button data-test="save">Save</button></section>';
    const page = createPage({ testIdAttribute: "data-test" });
    expect(await page.getByTestId("save").count()).toBe(1);
    expect(await page.getByTestId("panel").getByTestId("save").count()).toBe(1);
  });

  it("does not leak configuration between pages or existing locators", async () => {
    document.body.innerHTML =
      '<section><button data-a="save">A</button><button data-b="save">B</button><button data-testid="save">Default</button></section>';
    const first = createPage({ testIdAttribute: "data-a" });
    const existing = first.locator("section");
    const second = createPage({ testIdAttribute: "data-b" });
    expect(await first.getByTestId("save").textContent()).toBe("A");
    expect(await second.getByTestId("save").textContent()).toBe("B");
    expect(await existing.getByTestId("save").textContent()).toBe("A");
    expect(await createPage().getByTestId("save").textContent()).toBe(
      "Default"
    );
    await createPage().ariaSnapshot();
    expect(await first.getByTestId("save").textContent()).toBe("A");
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
});
