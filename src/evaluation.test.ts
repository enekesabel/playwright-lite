import { expect, it } from "vitest";

import { createPage } from "./index";

it("copies evaluation arguments and results like Playwright", async () => {
  const original = { nested: { value: 1 } };
  const result = await createPage().evaluate((argument) => {
    argument.nested.value = 2;
    return argument;
  }, original);

  expect(original).toEqual({ nested: { value: 1 } });
  expect(result).toEqual({ nested: { value: 2 } });
  expect(result).not.toBe(original);
  expect(result.nested).not.toBe(original.nested);
});
