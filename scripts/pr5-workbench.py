"""Temporary final verification edits for PR 5; removed after verification."""
from pathlib import Path
import hashlib
import urllib.request

PIN = "26a9e470a7b3c7822084b09fb7f13902c5f37b51"
root = Path.cwd()
sources = {
    "page-localstorage.spec.ts": ("tests/page/page-localstorage.spec.ts", "c02d2df50c5b4d0cd8ec5e4614d2b99746bbd158"),
    "locator-highlight.spec.ts": ("tests/library/locator-highlight.spec.ts", "6e4fd5bf7ab0ff862711c8aff1702face25afeb9"),
    "elementhandle-convenience.spec.ts": ("tests/page/elementhandle-convenience.spec.ts", "8e2f4895bf6d6073f600e2fc6d9782d48e8b09b2"),
}
for name, (source, expected) in sources.items():
    with urllib.request.urlopen(f"https://raw.githubusercontent.com/microsoft/playwright/{PIN}/{source}", timeout=30) as response:
        data = response.read()
    actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    assert actual == expected, (source, actual, expected)
    assert (root / "tests/upstream" / name).read_bytes() == data, name

path = root / "tests/upstream/adapter-bridge.ts"
text = path.read_text()
old = '      ? "\\nwindow.__pwLiteAdapterPage.injected.isUnderTest = true;"'
new = '''      ? `
        {
          // Init scripts run before documentElement exists. Preserve the lazy
          // production getter; only expose overlays when it is actually used.
          const page = window.__pwLiteAdapterPage;
          const getInjected = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(page), "injected"
          ).get;
          Object.defineProperty(page, "injected", {
            get() {
              const injected = getInjected.call(this);
              injected.isUnderTest = true;
              return injected;
            },
          });
        }`'''
if old in text:
    assert text.count(old) == 1
    path.write_text(text.replace(old, new))
else:
    assert "Preserve the lazy" in text

path = root / "src/browserCompat.test.ts"
text = path.read_text()
check = '  for (const root of roots) expect(root.mode).toBe("closed");\n'
if check not in text:
    target = '  await expect.poll(() => highlights().length).toBe(2);\n'
    assert target in text
    text = text.replace(target, target + check, 1)
    path.write_text(text)

path = root / "tests/upstream/_browser-compat-guard.spec.ts"
text = path.read_text()
if 'explicit navigation setup preserves browser evidence and failures' not in text:
    text += '''

base("explicit navigation setup preserves browser evidence and failures", async ({ page }) => {
  await page.route("http://pw-lite.test/**", route => route.fulfill({
    contentType: "text/html",
    body: "<button>Target</button>",
  }));
  const adapter = await createAdapterPage(page, { nativeNavigationForSetup: true });
  await adapter.goto("http://pw-lite.test/one");
  await adapter.localStorage.setItem("key", "value");
  await expect((adapter as any).missingBrowserOperation()).rejects.toThrow("is not a function");
  await adapter.goto("http://pw-lite.test/two");
  expect(await adapter.localStorage.getItem("key")).toBe("value");
  const entered = await page.evaluate(() => (window as any).__pwLiteEvidence.entered);
  expect(entered.filter((method: string) => method === "Page.localStorage.setItem")).toEqual([
    "Page.localStorage.setItem",
  ]);
  expect(entered).toContain("Page.localStorage.getItem");
  expect((page as any).__pwLiteTransportFailures).toHaveLength(1);
  expect((page as any).__pwLiteNativeOperations).toEqual(["Page.goto", "Page.goto"]);

  // Even with native setup enabled, a missing subject method must fail.
  await page.evaluate(() => {
    (window as any).__pwLiteAdapterPage.localStorage.getItem = undefined;
  });
  await expect(adapter.localStorage.getItem("key")).rejects.toThrow("is not a function");
  expect((page as any).__pwLiteNativeOperations).toEqual(["Page.goto", "Page.goto"]);
  expect((page as any).__pwLiteTransportFailures).toHaveLength(2);
});

test("highlight validates its style like stock Playwright before rendering", async ({ page, adapterPage }) => {
  for (const candidate of [page, adapterPage]) {
    for (const style of [123, true]) {
      await expect(candidate.locator("button").highlight({ style } as never)).rejects.toThrow(
        "style: expected string"
      );
    }
  }
});
'''
    path.write_text(text)
print("Pinned upstream bytes verified; lazy highlight setup and boundary guards present")
