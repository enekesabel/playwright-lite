import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const write = (path, content) => writeFileSync(path, content);
const replaceOnce = (text, before, after) => {
  assert.equal(text.split(before).length - 1, 1, `Expected one match for: ${before.slice(0, 80)}`);
  return text.replace(before, after);
};

let baselineTest = read("scripts/upstream-baseline.test.mjs");
baselineTest = replaceOnce(
  baselineTest,
  `      makeEntry("page-goto.spec.ts > d", "passed"),\n    ];`,
  `      makeEntry("page-goto.spec.ts > d", "passed"),\n      {\n        ...makeEntry("page-goto.spec.ts > diagnostic", "passed"),\n        execution: null,\n      },\n    ];`
);
baselineTest = replaceOnce(
  baselineTest,
  `    const reconciled =\n      result.currentPassing.length + result.failed + result.skipped;`,
  `    const reconciled =\n      result.currentPassing.length +\n      result.diagnosticPassed +\n      result.failed +\n      result.skipped;`
);
write("scripts/upstream-baseline.test.mjs", baselineTest);

let adapterGuard = read("tests/upstream/_adapter-guard.spec.ts");
assert.equal(adapterGuard.split("__pwLiteAdapterTimeout: true").length - 1, 2);
adapterGuard = adapterGuard.replaceAll('__pwLiteAdapterTimeout: true', 'kind: "adapter-timeout"');
write("tests/upstream/_adapter-guard.spec.ts", adapterGuard);

const baseline = JSON.parse(read("tests/upstream/baseline.json"));
const visible = baseline.reviewed.find((entry) => entry.id === "locator-misc-2.spec.ts > should waitFor");
assert.ok(visible);
visible.evidence = "After Locator.waitFor() resolves when <span>target</span> is inserted, toHaveText('target') verifies the located span contains 'target'.";
const hiddenId = "locator-misc-2.spec.ts > should waitFor hidden";
assert.equal(baseline.reviewed.filter((entry) => entry.id === hiddenId).length, 1);
baseline.reviewed = baseline.reviewed.filter((entry) => entry.id !== hiddenId);
write("tests/upstream/baseline.json", JSON.stringify(baseline, null, 2) + "\n");

let bridge = read("tests/upstream/adapter-bridge.ts");
bridge = replaceOnce(
  bridge,
  `  selectors.setTestIdAttribute = synchronize;\n  synchronize(initialAttributeName);\n  await synchronization;\n  testIdAttributeSynchronizers.set(realPage, () => synchronization);`,
  `  selectors.setTestIdAttribute = synchronize;\n  try {\n    synchronize(initialAttributeName);\n    await synchronization;\n  } catch (error) {\n    selectors.setTestIdAttribute = originalSetTestIdAttribute;\n    originalSetTestIdAttribute.call(selectors, DEFAULT_TEST_ID_ATTRIBUTE);\n    testIdAttributeSynchronizers.delete(realPage);\n    throw error;\n  }\n  testIdAttributeSynchronizers.set(realPage, () => synchronization);`
);
write("tests/upstream/adapter-bridge.ts", bridge);

let testServer = read("tests/upstream/testServer.ts");
testServer = replaceOnce(
  testServer,
  `import { type AddressInfo } from "node:net";`,
  `import { type AddressInfo } from "node:net";\nimport { dirname, extname, resolve, sep } from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst assetsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");`
);
testServer = replaceOnce(
  testServer,
  `  serveFile(routePath: string, filePath: string) {\n    this.setRoute(routePath, (_req, res) => {\n      const content = fs.readFileSync(filePath);\n      res.writeHead(200);\n      res.end(content);\n    });\n  }`,
  `  serveFile(routePath: string, filePath: string): void;\n  serveFile(\n    req: http.IncomingMessage,\n    res: http.ServerResponse,\n    filePath?: string\n  ): void;\n  serveFile(\n    routeOrRequest: string | http.IncomingMessage,\n    fileOrResponse: string | http.ServerResponse,\n    explicitFilePath?: string\n  ): void {\n    if (typeof routeOrRequest === "string") {\n      const filePath = fileOrResponse as string;\n      this.setRoute(routeOrRequest, (req, res) =>\n        this.writeFileResponse(req, res, filePath)\n      );\n      return;\n    }\n\n    const req = routeOrRequest;\n    const res = fileOrResponse as http.ServerResponse;\n    const urlPath = new URL(req.url ?? "/", this.PREFIX).pathname;\n    const filePath = explicitFilePath ?? resolve(assetsDir, "." + urlPath);\n    if (\n      !explicitFilePath &&\n      filePath !== assetsDir &&\n      !filePath.startsWith(assetsDir + sep)\n    ) {\n      res.writeHead(403);\n      res.end("Forbidden");\n      return;\n    }\n    this.writeFileResponse(req, res, filePath);\n  }\n\n  private writeFileResponse(\n    req: http.IncomingMessage,\n    res: http.ServerResponse,\n    filePath: string\n  ): void {\n    try {\n      const content = fs.readFileSync(filePath);\n      if (!res.hasHeader("Content-Type")) {\n        const extension = extname(filePath);\n        if (extension === ".html")\n          res.setHeader("Content-Type", "text/html; charset=utf-8");\n        else if (extension === ".png") res.setHeader("Content-Type", "image/png");\n      }\n      res.statusCode = 200;\n      res.end(req.method === "HEAD" ? undefined : content);\n    } catch {\n      if (!res.headersSent) {\n        res.statusCode = 404;\n        res.setHeader("Content-Type", "text/plain; charset=utf-8");\n      }\n      res.end(req.method === "HEAD" ? undefined : "File not found: " + filePath);\n    }\n  }`
);
write("tests/upstream/testServer.ts", testServer);

write("tests/upstream/_synchronization-guard.spec.ts", `import { expect, test, type Page } from "@playwright/test";\n\nimport { installTestIdAttributeSynchronization } from "./adapter-bridge";\n\ntest("restores the test ID setter when initial synchronization fails", async ({\n  page,\n  playwright,\n}) => {\n  const originalSetter = playwright.selectors.setTestIdAttribute;\n  const failingPage = {\n    evaluate: async () => {\n      throw new Error("forced initial test ID synchronization failure");\n    },\n  } as unknown as Page;\n\n  await expect(\n    installTestIdAttributeSynchronization(failingPage, playwright, "data-test")\n  ).rejects.toThrow("forced initial test ID synchronization failure");\n  expect(playwright.selectors.setTestIdAttribute).toBe(originalSetter);\n\n  const reset = await installTestIdAttributeSynchronization(\n    page,\n    playwright,\n    "data-test"\n  );\n  await reset();\n  expect(playwright.selectors.setTestIdAttribute).toBe(originalSetter);\n});\n`);

const pkg = JSON.parse(read("package.json"));
pkg.scripts["test:guards"] = "pnpm exec playwright test tests/upstream/_adapter-guard.spec.ts tests/upstream/_page-test-fixture.spec.ts tests/upstream/_synchronization-guard.spec.ts";
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

mkdirSync("tests/assets", { recursive: true });
const response = await fetch("https://raw.githubusercontent.com/microsoft/playwright/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/assets/grid.html");
assert.equal(response.ok, true, `Failed to fetch grid.html: ${response.status}`);
write("tests/assets/grid.html", await response.text());
