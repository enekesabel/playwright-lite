"""Temporary PR 5 final fixture verification; removed after verified promotion."""
from pathlib import Path
import hashlib
import urllib.request

PIN = "26a9e470a7b3c7822084b09fb7f13902c5f37b51"
root = Path.cwd()
sources = {
    "tests/upstream/page-localstorage.spec.ts": ("tests/page/page-localstorage.spec.ts", "c02d2df50c5b4d0cd8ec5e4614d2b99746bbd158"),
    "tests/upstream/locator-highlight.spec.ts": ("tests/library/locator-highlight.spec.ts", "6e4fd5bf7ab0ff862711c8aff1702face25afeb9"),
    "tests/upstream/elementhandle-convenience.spec.ts": ("tests/page/elementhandle-convenience.spec.ts", "8e2f4895bf6d6073f600e2fc6d9782d48e8b09b2"),
}
def download(source):
    with urllib.request.urlopen(f"https://raw.githubusercontent.com/microsoft/playwright/{PIN}/{source}", timeout=30) as response:
        return response.read()

for name, (source, expected) in sources.items():
    data = download(source)
    actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    assert actual == expected, (source, actual, expected)
    assert (root / name).read_bytes() == data, name

# Retain the upstream button fixture's own script instead of accepting a 404.
asset = "tests/assets/input/mouse-helper.js"
data = download(asset)
actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
assert actual == "3c4d57033c7f2a905e4d3a02d7484e3c5e5f3a21", actual
(root / asset).write_bytes(data)
button = "tests/assets/input/button.html"
assert (root / button).read_bytes() == download(button)

path = root / ".prettierignore"
text = path.read_text()
if asset not in text:
    path.write_text(text + asset + "\n")

path = root / "tests/config/browserTest.ts"
text = path.read_text()
if 'server.setRoute("/input/mouse-helper.js"' not in text:
    old = '    server.serveFile("/input/button.html", asset("input/button.html"));'
    assert text.count(old) == 1
    text = text.replace(old, old + '''
    server.setRoute("/input/mouse-helper.js", (req, res) => {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      server.serveFile(req, res, asset("input/mouse-helper.js"));
    });''')
    path.write_text(text)

path = root / "tests/upstream/_browser-compat-guard.spec.ts"
text = path.read_text()
if 'page.locator(".mouse-helper")' not in text:
    old = 'browserTest("library-created pages use the same adapter before context cleanup", async ({ browser }) => {'
    assert text.count(old) == 1
    text = text.replace(old, old.replace('{ browser }', '{ browser, server }'))
    old = '  await page.setContent("<button>Library</button>");'
    assert text.count(old) == 1
    text = text.replace(old, '''  await page.goto(server.PREFIX + "/input/button.html");
  expect(await page.locator(".mouse-helper").count()).toBe(1);
''' + old)
    path.write_text(text)
print("Exact upstream specs and complete button fixture verified; baseline promotions remain explicit")
