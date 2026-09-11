import { afterEach, describe, expect, it } from "vitest";
import { createPage } from "./index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.waitFor attachment states", () => {
  it("waits for insertion and removal with the existing strict polling loop", async () => {
    const page = createPage();
    const locator = page.locator("#target");
    const attached = locator.waitFor({ state: "attached", timeout: 1000 });
    document.body.innerHTML = '<div id="target" hidden></div>';
    await attached;

    let completed = false;
    const detached = locator
      .waitFor({ state: "detached", timeout: 1000 })
      .then(() => {
        completed = true;
      });
    await page.waitForTimeout(75);
    expect(completed).toBe(false);
    document.querySelector("#target")!.remove();
    await detached;
    expect(completed).toBe(true);
  });

  it.each(["attached", "detached"] as const)(
    "keeps %s waits strict",
    async (state) => {
      document.body.innerHTML =
        '<div class="target"></div><div class="target"></div>';
      await expect(
        createPage().locator(".target").waitFor({ state, timeout: 100 })
      ).rejects.toThrow("strict mode violation");
    }
  );

  it.each(["attached", "detached"] as const)(
    "honors the default timeout for %s",
    async (state) => {
      document.body.innerHTML =
        state === "detached" ? '<div id="target"></div>' : "";
      const page = createPage();
      page.setDefaultTimeout(30);
      await expect(page.locator("#target").waitFor({ state })).rejects.toThrow(
        "Timeout 30ms exceeded"
      );
    }
  );
});

describe.each(["Page", "Locator"] as const)("%s.click options", (owner) => {
  it("checks trial actionability without dispatching input events", async () => {
    document.body.innerHTML = '<button id="target" disabled>Click</button>';
    const button = document.querySelector<HTMLButtonElement>("#target")!;
    const events: string[] = [];
    for (const name of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ])
      button.addEventListener(name, () => events.push(name));
    const page = createPage();
    const click =
      owner === "Page"
        ? page.click.bind(page, "#target")
        : page.locator("#target").click.bind(page.locator("#target"));
    await expect(click({ trial: true, timeout: 50 })).rejects.toThrow(
      "Timeout 50ms exceeded"
    );
    button.disabled = false;
    await click({ trial: true });
    expect(events).toEqual([]);
    await click();
    expect(events).toContain("click");
  });

  it("uses the requested padding-box position", async () => {
    document.body.innerHTML =
      '<button id="target" style="width:100px;height:60px;border:8px solid black">Click</button>';
    const button = document.querySelector<HTMLButtonElement>("#target")!;
    let point: { x: number; y: number } | undefined;
    button.addEventListener("click", (event) => {
      point = { x: event.clientX, y: event.clientY };
    });
    const page = createPage();
    const options = { position: { x: 20, y: 10 } };
    if (owner === "Page") await page.click("#target", options);
    else await page.locator("#target").click(options);
    const bounds = button.getBoundingClientRect();
    expect(point).toEqual({ x: bounds.x + 8 + 20, y: bounds.y + 8 + 10 });
  });

  it.each([false, true])(
    "scrolls an oversized target's requested point (nested: %s)",
    async (nested) => {
      document.body.innerHTML = `<div id="container" style="${nested ? "width:250px;height:200px;overflow:auto;" : ""}"><div id="target" style="margin-top:100px;width:${window.innerWidth * 3}px;height:${window.innerHeight * 3}px;border:8px solid black">Click</div></div>`;
      const button = document.querySelector<HTMLDivElement>("#target")!;
      const events: { x: number; y: number }[] = [];
      button.addEventListener("click", (event) =>
        events.push({ x: event.clientX, y: event.clientY })
      );
      const page = createPage();
      const click =
        owner === "Page"
          ? page.click.bind(page, "#target")
          : page.locator("#target").click.bind(page.locator("#target"));
      for (const position of [
        { x: 10, y: 10 },
        { x: window.innerWidth * 2, y: window.innerHeight * 2 },
      ]) {
        const before = events.length;
        await click({ position, trial: true, timeout: 1000 });
        expect(events).toHaveLength(before);
        await click({ position, timeout: 1000 });
        const bounds = button.getBoundingClientRect();
        expect(events.at(-1)).toEqual({
          x: bounds.x + 8 + position.x,
          y: bounds.y + 8 + position.y,
        });
        expect(events.at(-1)!.x).toBeGreaterThanOrEqual(0);
        expect(events.at(-1)!.x).toBeLessThan(window.innerWidth);
        expect(events.at(-1)!.y).toBeGreaterThanOrEqual(0);
        expect(events.at(-1)!.y).toBeLessThan(window.innerHeight);
      }
    }
  );

  it("validates new options and ignores undefined unsupported options", async () => {
    document.body.innerHTML = '<button id="target">Click</button>';
    const page = createPage();
    const locator = page.locator("#target");
    const click =
      owner === "Page"
        ? page.click.bind(page, "#target")
        : locator.click.bind(locator);
    // Invalid input must fail before dispatching any event.
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    await expect(
      click({ trial: "yes" } as unknown as Parameters<typeof click>[0])
    ).rejects.toThrow("trial must be a boolean");
    await expect(click({ position: { x: NaN, y: 0 } })).rejects.toThrow(
      "finite x and y"
    );
    expect(clicks).toBe(0);
    await click({ force: undefined, trial: true });
    expect(clicks).toBe(0);
  });
});

it("Locator.all captures the length, not the resolved elements", async () => {
  document.body.innerHTML = "<ul><li>old</li></ul>";
  const locators = await createPage().locator("li").all();
  document.querySelector("ul")!.innerHTML = "<li>new</li><li>extra</li>";
  expect(locators).toHaveLength(1);
  expect(await locators[0]!.textContent()).toBe("new");
});
