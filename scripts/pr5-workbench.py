"""Temporary PR 5 editing script; removed after reviewed verification."""
from pathlib import Path
import hashlib
import re
import urllib.request

PIN = "26a9e470a7b3c7822084b09fb7f13902c5f37b51"
root = Path.cwd()
updates = {}


def read(path):
    return updates.get(path, (root / path).read_text())


def replace(path, old, new):
    text = read(path)
    assert text.count(old) == 1, (path, old[:100], text.count(old))
    updates[path] = text.replace(old, new)


corpus = read("tests/upstream/corpus.ts")
assert f'commit: "{PIN}"' in corpus
sources = {
    "page-localstorage.spec.ts": ("tests/page/page-localstorage.spec.ts", "c02d2df50c5b4d0cd8ec5e4614d2b99746bbd158"),
    "locator-highlight.spec.ts": ("tests/library/locator-highlight.spec.ts", "6e4fd5bf7ab0ff862711c8aff1702face25afeb9"),
    "elementhandle-convenience.spec.ts": ("tests/page/elementhandle-convenience.spec.ts", "8e2f4895bf6d6073f600e2fc6d9782d48e8b09b2"),
}
downloaded = {}
for name, (source, expected) in sources.items():
    with urllib.request.urlopen(f"https://raw.githubusercontent.com/microsoft/playwright/{PIN}/{source}", timeout=30) as response:
        data = response.read()
    actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    assert actual == expected, (source, actual, expected)
    downloaded[name] = data

# A second explicitly requested run verifies, rather than reapplying, the patch.
if "sourcePaths:" in corpus:
    for name, data in downloaded.items():
        assert (root / "tests/upstream" / name).read_bytes() == data
    print("PR 5 patch already applied; exact upstream bytes verified")
    raise SystemExit(0)

entries = "".join(f'    "{name}": "{hashlib.sha256(data).hexdigest()}",\n' for name, data in downloaded.items())
replace("tests/upstream/corpus.ts", "  specs: {\n", '  sourcePaths: {\n    "locator-highlight.spec.ts": "tests/library/locator-highlight.spec.ts",\n  },\n  specs: {\n' + entries)
replace("scripts/upstream-specs.mjs", '  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${basePath}/${spec}`;', '  const sourcePath = corpus.sourcePaths[spec] ?? `${basePath}/${spec}`;\n  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${sourcePath}`;')
replace("scripts/upstream-specs.mjs", '  specs: {\n${specEntries}', '  sourcePaths: ${JSON.stringify(corpus.sourcePaths, null, 2)},\n  specs: {\n${specEntries}')

bridge = "tests/upstream/adapter-bridge.ts"
replace(bridge, 'type AdapterPageState = { url: string };', 'type AdapterPageState = {\n  url: string;\n  nativeNavigationForSetup?: boolean;\n};')
replace(bridge, 'type AdapterTimeoutDefaults = {\n  actionTimeout?: number;\n  navigationTimeout?: number;\n};', 'type AdapterTimeoutDefaults = {\n  actionTimeout?: number;\n  navigationTimeout?: number;\n  // Fixture-only settings. Neither is a production createPage option.\n  nativeNavigationForSetup?: boolean;\n  underTest?: boolean;\n};')
text = read(bridge)
start = text.index('  await realPage.evaluate(() => {\n    const host = window as any;\n    host.__pwLiteEvidence')
end = text.index('\n\n  const evaluate = realPage.evaluate.bind(realPage);', start)
block = text[start:end]
assert block.endswith('  });')
body = block[len('  await realPage.evaluate(() => {\n'):-len('  });')]
body = '\n'.join(line[2:] if line.startswith('  ') else line for line in body.splitlines())
updates[bridge] = text[:start] + text[end:] + '\n\nfunction initializeAdapterBridge() {\n' + body + '\n}\n'
replace(bridge, '    `\\n${configuredTimeouts}`;', '    `\\n${configuredTimeouts}` +\n    // Pinned upstream tests expose the highlight shadow root in test mode.\n    // Keep production closed-root behavior unchanged and separately tested.\n    (timeoutDefaults.underTest\n      ? "\\nwindow.__pwLiteAdapterPage.injected.isUnderTest = true;"\n      : "") +\n    `\\n(${initializeAdapterBridge.toString()})();`;')
replace(bridge, '  const state: AdapterPageState = {\n    url:', '  const state: AdapterPageState = {\n    nativeNavigationForSetup: timeoutDefaults.nativeNavigationForSetup,\n    url:')
needle = '      // Only ledger-declared out-of-scope Page members may use the native'
replace(bridge, needle, '''      // Explicit fixture setup, never fallback after an adapter failure.
      // Only specs whose subject is storage/highlighting opt in. Every such
      // navigation is recorded and cannot certify Page.goto compatibility.
      if (prop === "goto" && state.nativeNavigationForSetup) {
        return async (...args: Parameters<Page["goto"]>) => {
          const previous = await realPage.evaluate(
            () => (window as any).__pwLiteEvidence
          );
          nativeOperationLog(realPage).push("Page.goto");
          const response = await realPage.goto(...args);
          await realPage.evaluate((prior) => {
            const current = (window as any).__pwLiteEvidence;
            current.entered.unshift(...prior.entered);
            current.failures.unshift(...prior.failures);
          }, previous);
          state.url = await evaluateAdapter<string>(realPage, () => {
            const host = window as any;
            return host.__pwLiteInvokeAdapter(() => host.__pwLiteAdapterPage.url());
          }, undefined);
          return wrapNativeResult(response, realPage);
        };
      }

''' + needle)

replace("tests/upstream/pageTest.ts", '      const proxyPage = await createAdapterPage(page, {\n        actionTimeout,\n        navigationTimeout,\n      });', '      const proxyPage = await createAdapterPage(page, {\n        actionTimeout,\n        navigationTimeout,\n        // This exact upstream spec tests WebStorage, not navigation.\n        // The bridge records setup navigation separately from browser calls.\n        nativeNavigationForSetup: testInfo.file.endsWith("/page-localstorage.spec.ts"),\n      });')
replace("tests/config/browserTest.ts", 'return createAdapterPage(page);', 'return createAdapterPage(page, {\n                      nativeNavigationForSetup: true,\n                      underTest: true,\n                    });')
replace("tests/config/browserTest.ts", 'export const browserTest = pageTest.extend<{ _libraryEvidence: void }>({', '''export const browserTest = pageTest.extend<{ _libraryEvidence: void }>({
  server: async ({ server, asset }, use) => {
    server.serveFile("/input/button.html", asset("input/button.html"));
    await use(server);
  },''')
replace("tests/config/browserTest.ts", ' * Navigation and every Page/Locator operation still use the normal adapter.', ' * Only declared navigation setup is native and recorded. The methods under\n * test and all their assertions still execute through the browser adapter.')
replace("src/locator.ts", "this._frame._selector + ' >> internal:chain='", "this._selector + ' >> internal:chain='")
replace("src/page.ts", '  async addHighlight(selector: string, style?: string): Promise<void> {\n    try {', '  async addHighlight(selector: string, style?: string): Promise<void> {\n    if (style !== undefined) style = validateString(style, "style");\n    try {')

# Keep fixture allowances and production limitations visible beside the rules.
updates["AGENTS.md"] = read("AGENTS.md").replace('## Baseline promotion', '''## Upstream fixture setup

The unchanged `page-localstorage.spec.ts` and library highlight specs use
explicitly enabled native `goto` only to establish their test document/origin.
These calls are recorded as `Page.goto` in native execution evidence. They can
never certify navigation compatibility. No failed adapter call is retried via
the native driver. All storage/highlight operations and assertions use the
browser adapter. Library highlight tests use the pinned InjectedScript's test
mode to expose its shadow root; direct runtime tests also verify the production
closed-root overlay without changing its mode.

## Baseline promotion''')
updates[".prettierignore"] = read(".prettierignore") + "tests/assets/input/button.html\n"

# Register exact upstream fixture data, not a local substitute.
with urllib.request.urlopen(f"https://raw.githubusercontent.com/microsoft/playwright/{PIN}/tests/assets/input/button.html", timeout=30) as response:
    asset = response.read()
for path, text in updates.items():
    (root / path).write_text(text)
for name, data in downloaded.items():
    (root / "tests/upstream" / name).write_bytes(data)
(root / "tests/assets/input").mkdir(parents=True, exist_ok=True)
(root / "tests/assets/input/button.html").write_bytes(asset)
print("Applied PR 5 changes; upstream specs preserved byte-for-byte")
