import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

describe("Page.waitForEvent", () => {
  it("accepts an unknown event name silently", async () => {
    await expect(
      createPage().waitForEvent("unknown" as "load", { timeout: 5 })
    ).rejects.toThrow("Timeout 5ms exceeded");
  });

  it("resolves with the payload once the predicate accepts it", async () => {
    const page = createPage();
    const seen: string[] = [];
    const waiting = page.waitForEvent("pageerror", (error) => {
      seen.push(error.message);
      return error.message === "second";
    });
    report(new Error("first"));
    report(new Error("second"));
    await expect(waiting).resolves.toMatchObject({ message: "second" });
    expect(seen).toEqual(["first", "second"]);
  });

  it("rejects with a throwing predicate", async () => {
    const waiting = createPage().waitForEvent("pageerror", () => {
      throw new Error("predicate failed");
    });
    report(new Error("any"));
    await expect(waiting).rejects.toThrow("predicate failed");
  });
});
