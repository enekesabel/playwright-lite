import { describe, expect, it } from "vitest";

import { consolePages } from "./console";

describe("Page.clearConsoleMessages", () => {
  const createPage = consolePages();

  it("empties the buffer without stopping further collection", async () => {
    const page = createPage();
    await page.consoleMessages();
    console.log("message1");
    console.log("message2");

    let messages = await page.consoleMessages();
    expect(messages.map((m) => m.text())).toEqual(["message1", "message2"]);

    await page.clearConsoleMessages();
    messages = await page.consoleMessages();
    expect(messages).toEqual([]);

    console.log("message3");
    messages = await page.consoleMessages();
    expect(messages.map((m) => m.text())).toEqual(["message3"]);
  });
});
