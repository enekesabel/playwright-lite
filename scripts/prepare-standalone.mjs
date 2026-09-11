import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const write = (path, content) => writeFileSync(path, content);
function once(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, `Expected exactly one occurrence: ${before.slice(0, 100)}`);
  return text.replace(before, after);
}

if (read("src/page.ts").includes("testIdAttributeNameFor")) {
  let page = read("src/page.ts");
  page = once(page, "  testIdAttributeNameFor,", "  DEFAULT_TEST_ID_ATTRIBUTE,");
  page = once(page, "  constructor(browserWindow: Window & typeof globalThis) {\n    this.window = browserWindow;", "  constructor(browserWindow: Window & typeof globalThis, public testIdAttribute = DEFAULT_TEST_ID_ATTRIBUTE) {\n    this.window = browserWindow;");
  page = page.replaceAll("testIdAttributeNameFor(this.window)", "this.testIdAttribute");
  page = once(page, "injectedScriptFor(this.document.documentElement)", "injectedScriptFor(this.document.documentElement, testIdAttributeName)");
  page = once(page, "  static fromWindow(browserWindow: Window & typeof globalThis = window) {\n    return new PageImpl(browserWindow);\n  }", "  static fromWindow(browserWindow: Window & typeof globalThis = window, testIdAttribute = DEFAULT_TEST_ID_ATTRIBUTE) {\n    return new PageImpl(browserWindow, testIdAttribute);\n  }");
  write("src/page.ts", page);
  let locator = read("src/locator.ts");
  locator = locator.replace(/import\s*\{\s*testIdAttributeNameFor\s*\}\s*from\s*["']\.\/injected["'];?\n/g, "");
  locator = locator.replaceAll("testIdAttributeNameFor(this.ownerPage.window)", "this.ownerPage.testIdAttribute");
  assert.ok(!locator.includes("testIdAttributeNameFor"), "Unexpected locator configuration reference");
  write("src/locator.ts", locator);
}

let contract = read("src/contract.test.ts");
if (contract.includes("const compiledTimeoutGlobals")) {
  const start = contract.indexOf("const compiledTimeoutGlobals");
  const end = contract.indexOf('describe("Single-document adapter contract"');
  assert.ok(end > start);
  contract = contract.slice(0, start) + contract.slice(end);
  const first = contract.indexOf('    it("applies compiled defaults to the page returned by createPage"');
  const second = contract.indexOf('    it("applies compiled and runtime navigation defaults');
  assert.ok(first >= 0 && second > first);
  contract = contract.slice(0, first) + `    it("applies configured defaults to the page returned by createPage", async () => {
      document.body.innerHTML = "";
      const page = createPage({ actionTimeout: 5 });
      await expect(page.locator("#missing").click()).rejects.toThrow("Timeout 5ms exceeded");
    });

` + contract.slice(second);
  contract = once(contract, "      const restoreCompiledTimeouts = installCompiledTimeouts(undefined, 7);\n", "");
  const navStart = contract.indexOf('    it("applies compiled and runtime navigation defaults');
  const navEnd = contract.indexOf("  // ── AC2", navStart);
  let navigation = contract.slice(navStart, navEnd);
  navigation = once(navigation, "const page = createPage();", "const page = createPage({ navigationTimeout: 7 });");
  navigation = once(navigation, "        restoreCompiledTimeouts();\n", "");
  navigation = navigation.replaceAll("compiled", "configured");
  contract = contract.slice(0, navStart) + navigation + contract.slice(navEnd);
  assert.ok(!contract.includes("installCompiledTimeouts"));
  write("src/contract.test.ts", contract);
}

let bridge = read("tests/upstream/adapter-bridge.ts");
if (bridge.includes("__aymeTestIdAttributeName?: string")) {
  bridge = once(bridge, `          __aymeTestIdAttributeName?: string;
        }).__aymeTestIdAttributeName = testIdAttributeName;`, `          __aymeAdapterPage: { testIdAttribute: string };
        }).__aymeAdapterPage.testIdAttribute = testIdAttributeName;`);
  write("tests/upstream/adapter-bridge.ts", bridge);
}

let declarations = read("build/playwright-injected.d.ts");
declarations = declarations.replace(/  export type CaptureAriaSnapshotResult = \{[\s\S]*?\n  \};\n\n/, "");
declarations = declarations.replace(/    captureAriaSnapshot\(root: Element\): CaptureAriaSnapshotResult;\n/, "");
write("build/playwright-injected.d.ts", declarations);
rmSync("src/types.ts", { force: true });
rmSync("turbo.json", { force: true });

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const path of files) {
  if (["scripts/prepare-standalone.mjs", ".github/workflows/prepare.yml", "src/types.ts", "turbo.json"].includes(path)) continue;
  let text = read(path);
  text = text.replaceAll("@ayme-dev/playwright-browser", "@enekesabel/playwright-lite")
    .replaceAll("ayme-labs/playwright", "microsoft/playwright")
    .replaceAll("b25d782e3fbdf21abdae60e974e49b78ca07e828", "26a9e470a7b3c7822084b09fb7f13902c5f37b51")
    .replaceAll("b25d782", "26a9e47")
    .replaceAll("virtual:ayme-playwright-injected", "virtual:playwright-lite-injected")
    .replaceAll("isAymeLocator", "isPlaywrightLiteLocator")
    .replaceAll("ayme:playwright-browser", "playwright-lite")
    .replaceAll("ayme:locator", "playwright-lite:locator")
    .replaceAll("__ayme", "__pwLite")
    .replaceAll("Ayme", "PlaywrightLite")
    .replaceAll("AYME", "PLAYWRIGHT_LITE")
    .replaceAll("ayme", "playwright-lite")
    .replaceAll("playwright-browser", "playwright-lite");
  write(path, text);
}
const baseline = JSON.parse(read("tests/upstream/baseline.json"));
assert.ok(!baseline.reviewed.some(entry => entry.id.includes("should capture full refs without changing public snapshots")), "Fork-specific test was reviewed; do not discard it silently");
assert.equal(baseline.reviewed.length, 263);
assert.ok([587, 588].includes(baseline.selectedTestCount));
baseline.selectedTestCount = 587;
write("tests/upstream/baseline.json", JSON.stringify(baseline, null, 2) + "\n");
