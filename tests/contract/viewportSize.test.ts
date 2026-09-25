import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { PageImpl } from "../../src/page";

describe("Page.viewportSize", () => {
  let iframe: HTMLIFrameElement | undefined;

  afterEach(() => {
    iframe?.remove();
    iframe = undefined;
  });

  function framedPage(width: number, height: number) {
    iframe = document.createElement("iframe");
    iframe.style.cssText = `border: 0; width: ${width}px; height: ${height}px`;
    document.body.appendChild(iframe);
    return new PageImpl(iframe.contentWindow! as Window & typeof globalThis);
  }

  it("returns the window's inner size synchronously, never null", () => {
    const page = createPage();

    expect(page.viewportSize()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });

  it("reads the controlled window's current size on every call", () => {
    const page = framedPage(320, 200);
    expect(page.viewportSize()).toEqual({ width: 320, height: 200 });

    iframe!.style.width = "480px";
    iframe!.style.height = "240px";

    // Playwright keeps returning the configured viewport; the window's own
    // size is all a document can report.
    expect(page.viewportSize()).toEqual({ width: 480, height: 240 });
  });
});
