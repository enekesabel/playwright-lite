from pathlib import Path
import hashlib
import os
import tarfile
import urllib.request

root = Path.cwd()
upstream = Path(os.environ['RUNNER_TEMP']) / 'pointer-upstream'
if not upstream.exists():
    archive = Path(os.environ['RUNNER_TEMP']) / 'pointer-upstream.tgz'
    urllib.request.urlretrieve('https://codeload.github.com/microsoft/playwright/tar.gz/26a9e470a7b3c7822084b09fb7f13902c5f37b51', archive)
    with tarfile.open(archive) as tar:
        tar.extractall(upstream, filter='data')
source = next(upstream.iterdir())

def replace(path, before, after):
    file = root / path
    text = file.read_text()
    assert text.count(before) == 1, (path, before[:100], text.count(before))
    file.write_text(text.replace(before, after))

specs = ['page-click.spec.ts', 'elementhandle-click.spec.ts', 'page-click-scroll.spec.ts'] + [f'page-click-timeout-{i}.spec.ts' for i in range(1, 5)]
entries = []
for name in specs:
    data = (source / 'tests/page' / name).read_bytes()
    (root / 'tests/upstream' / name).write_bytes(data)
    entries.append(f'    "{name}": "{hashlib.sha256(data).hexdigest()}",')
replace('tests/upstream/corpus.ts', '  specs: {', '  specs: {\n' + '\n'.join(entries))
assets = ['input/button.html', 'input/mouse-helper.js', 'input/animating-button.html', 'input/scrollable.html', 'input/textarea.html', 'input/checkbox.html', 'input/rotatedButton.html', 'shadow.html', 'offscreenbuttons.html', 'wrappedlink.html', 'counter.html', 'frames/frameset.html', 'frames/frame.html']
for name in assets:
    file = root / 'tests/assets' / name
    data = (source / 'tests/assets' / name).read_bytes()
    if file.exists():
        assert file.read_bytes() == data, name
    else:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
replace('tests/upstream/pageTest.ts', '''        // This exact upstream spec tests WebStorage, not navigation.
        // The bridge records setup navigation separately from browser calls.
        nativeNavigationForSetup: testInfo.file.endsWith(
          "/page-localstorage.spec.ts"
        ),''', '''        // Native navigation establishes the document only. It is recorded and
        // cannot certify navigation or replace a failed browser-adapter action.
        nativeNavigationForSetup: [
          "page-localstorage.spec.ts",
          "page-click.spec.ts",
          "elementhandle-click.spec.ts",
          "page-click-scroll.spec.ts",
          "page-click-timeout-1.spec.ts",
          "page-click-timeout-2.spec.ts",
          "page-click-timeout-3.spec.ts",
          "page-click-timeout-4.spec.ts",
        ].some((name) => testInfo.file.endsWith(`/${name}`)),''')
replace('tests/upstream/pageTest.ts', '''  browserMajorVersion: async ({}, use) => {
    const version = process.env.PLAYWRIGHT_BROWSER_VERSION ?? "0";
    await use(parseInt(version, 10));
  },''', '''  browserMajorVersion: async ({ browser }, use) => {
    await use(parseInt(browser.version(), 10));
  },''')
replace('tests/upstream/testServer.ts', '''        else if (extension === ".png")''', '''        else if (extension === ".js")
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        else if (extension === ".css")
          res.setHeader("Content-Type", "text/css; charset=utf-8");
        else if (extension === ".png")''')
replace('tests/upstream/testServer.ts', '''    res.writeHead(404);
    res.end("Not found");''', '''    // Same asset-root containment check as explicit serveFile calls.
    this.serveFile(req, res);''')
