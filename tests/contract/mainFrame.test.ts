import { afterEach, describe, expect, it } from "vitest";

import { PageImpl } from "../../src/page";

describe("Page.mainFrame", () => {
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

  it("keeps the controlled document as the main frame facade", () => {
    const page = setupDedicatedPage("<p>hello</p>");
    expect(page.mainFrame()).toBe(page);
  });
});
