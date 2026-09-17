import { afterEach, describe, expect, it } from "vitest";

import { PageImpl } from "../../src/page";

describe("Page.content", () => {
  let iframe: HTMLIFrameElement;

  function setupDedicatedPage(html: string) {
    iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const win = iframe.contentWindow! as Window & typeof globalThis;
    win.document.open();
    win.document.write(html);
    win.document.close();
    return new PageImpl(win);
  }

  afterEach(() => {
    iframe?.remove();
  });

  it("serializes content from native fixture setup", async () => {
    const page = setupDedicatedPage("<!DOCTYPE html><div>hello</div>");
    expect(await page.content()).toBe(
      "<!DOCTYPE html><html><head></head><body><div>hello</div></body></html>"
    );
  });
});
