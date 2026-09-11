import { describe, expect, it } from "vitest";

import {
  formatLocatorChainDescription,
  formatLocatorDescription,
} from "./locatorFormatting";

describe("locator formatting", () => {
  it("formats every recorded locator step and escapes string values", () => {
    const chain = [
      ["getByRole", ["button", { name: "O'Reilly" }]],
      ["nth", [1]],
      ["locator", ["span's"]],
    ] as const;

    expect(formatLocatorChainDescription(chain)).toBe(
      "getByRole('button', { name: 'O\\'Reilly' }).nth(1).locator('span\\'s')"
    );
  });

  it("formats recorded locator methods with their supported options", () => {
    const chain = [
      ["locator", ["section", { hasText: "owner's" }]],
      ["filter", [{ visible: false }]],
      ["getByText", ["child's", { exact: true }]],
      ["first", []],
    ] as const;

    expect(formatLocatorChainDescription(chain)).toBe(
      "locator('section', { hasText: 'owner\\'s' }).filter({ visible: false }).getByText('child\\'s', { exact: true }).first()"
    );
  });

  it("keeps custom descriptions ahead of chain formatting", () => {
    const chain = [["locator", ["button's"]]] as const;

    expect(formatLocatorChainDescription(chain, "Submit button")).toBe(
      "Submit button"
    );
  });

  it("preserves double quotes, backslashes and line breaks without formatting twice", () => {
    const value = "a\"b\\c\n'd";
    const expected = String.raw`locator('a"b\\c\n\'d')`;
    expect(formatLocatorChainDescription([["locator", [value]]])).toBe(
      expected
    );
    expect(
      formatLocatorDescription(`page.locator(${JSON.stringify(value)})`)
    ).toBe(expected);
  });

  it("keeps regex and nested locator arguments readable", () => {
    const child = { toString: () => "getByText('child')" };
    expect(
      formatLocatorChainDescription([
        ["locator", ["section"]],
        ["filter", [{ has: child, hasText: /hello/i, hasNotText: undefined }]],
        ["last", []],
      ])
    ).toBe(
      "locator('section').filter({ has: getByText('child'), hasText: /hello/i }).last()"
    );
  });

  it("escapes strings in labels created by the page facade", () => {
    expect(
      formatLocatorDescription(`page.locator(${JSON.stringify("a'b")})`)
    ).toBe("locator('a\\'b')");
  });
});
