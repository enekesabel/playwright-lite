// Feasibility probe for #259: input into closed shadow roots.
//
//   node docs/research/closed-shadow-root-input/probe.mjs [adapter-dist-dir]
//
// Runs the same scenarios with native Playwright and with a playwright-lite
// build loaded into the page, and prints what each element received. The
// adapter defaults to ./dist (run `pnpm build` first); pass the dist of a
// build with prototype.patch applied to see the prototype. Observations here
// are feasibility evidence only, not reviewed adapter compatibility evidence.

import { resolve } from "node:path";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import { chromium, selectors } from "playwright";

const distDir = resolve(process.argv[2] ?? "dist");
const bundle = (
  await build({
    entryPoints: [resolve(distDir, "index.mjs")],
    bundle: true,
    format: "iife",
    globalName: "playwrightLite",
    write: false,
    logLevel: "silent",
  })
).outputFiles[0].text;

const ORIGIN = "http://probe.test";

// Fixture document. `window.__fixture` keeps the closed roots for the probe
// only: it observes the inside and focuses the input, as a test harness would.
// The adapter never reads it.
const inputFixture = `<!doctype html>
<style>body{margin:0}</style>
<div id=host style="position:absolute;left:0;top:0;width:300px;height:150px"></div>
<button id=outside style="position:absolute;left:0;top:200px;width:100px;height:40px">Outside</button>
<script>
  window.__log = [];
  const label = (n) => n.id ? "#" + n.id : n.nodeName ? n.nodeName.toLowerCase() : String(n);
  const types = ["pointerdown", "mousedown", "mouseup", "click", "focusin", "focusout", "keydown", "beforeinput", "input"];
  const watch = (node, where) => types.forEach((type) =>
    node.addEventListener(type, (e) => window.__log.push(
      where + " " + type + " target=" + label(e.target) + " path=" + e.composedPath().map(label).join(">"))));
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = \`<style>[abs]{position:absolute}</style>
    <button id=inner abs style="left:10px;top:10px;width:100px;height:40px">Inner</button>
    <input id=field abs style="left:10px;top:70px;width:150px;height:30px">
    <div id=nestedHost abs style="left:180px;top:10px;width:100px;height:100px"></div>\`;
  const nested = root.getElementById("nestedHost").attachShadow({ mode: "closed" });
  nested.innerHTML = '<button id=deep style="width:80px;height:40px">Deep</button>';
  watch(document, "outside");
  watch(root, "root");
  watch(nested, "nested");
  window.__fixture = { root, nested };
</script>`;

// Each closed host holds a button whose inline handler records its name, so a
// click shows whether input reached inside without touching the root.
const captureFixture = `<!doctype html>
<style>body{margin:0} div,x-el,x-hydrate{display:block;width:120px;height:40px;margin:4px}</style>
<script>
  window.__hits = [];
  window.__button = (name) => '<button style="width:100px;height:30px" onclick="__hits.push(\\'' + name + '\\')">' + name + '</button>';
  customElements.define("x-el", class extends HTMLElement {
    constructor() { super(); window.__internals = this.attachInternals(); }
  });
</script>
<div id=inlineScript></div>
<script>inlineScript.attachShadow({ mode: "closed" }).innerHTML = __button("inlineScript");</script>
<div id=declarative><template shadowrootmode=closed><button style="width:100px;height:30px" onclick="__hits.push('declarative')">declarative</button></template></div>
<div id=declarativeSerializable><template shadowrootmode=closed shadowrootserializable><button style="width:100px;height:30px" onclick="__hits.push('declarativeSerializable')">declarativeSerializable</button></template></div>
<x-el id=customElementDeclarative><template shadowrootmode=closed><button style="width:100px;height:30px" onclick="__hits.push('customElementDeclarative')">customElementDeclarative</button></template></x-el>
<x-hydrate id=declarativeThenAttachShadow><template shadowrootmode=closed><button style="width:100px;height:30px" onclick="__hits.push('declarativeThenAttachShadow')">declarativeThenAttachShadow</button></template></x-hydrate>
<script>
  // Hydration, as server-rendered components do: defined after parsing, the
  // element asks attachShadow() for its root and gets the declarative one
  // back, emptied, so it renders again.
  customElements.define("x-hydrate", class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "closed" }).innerHTML = __button("declarativeThenAttachShadow");
    }
  });
</script>
<div id=otherRealm></div>
<script>
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  document.body.append(frame);
  frame.contentWindow.Element.prototype.attachShadow.call(otherRealm, { mode: "closed" }).innerHTML = __button("otherRealm");
</script>
<div id=isolatedWorld></div>
<div id=afterLoad></div>`;

async function withPage(browser, initScripts, html, run) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: html })
  );
  for (const script of initScripts) await page.addInitScript(script);
  await page.goto(`${ORIGIN}/`);
  try {
    return await run(page);
  } finally {
    await page.close();
  }
}

const adapterInit = `${bundle};window.__pl = playwrightLite;`;

/** Calls `page.mouse` / `page.keyboard` natively or through the adapter. */
function driver(page, mode) {
  const call = (expression) =>
    mode === "native"
      ? new Function("page", `return page.${expression}`)(page)
      : page.evaluate(`(window.__plPage ??= __pl.createPage()).${expression}`);
  return {
    click: (x, y) => call(`mouse.click(${x}, ${y})`),
    clickHost: () => call(`locator("#host").click()`),
    type: (text) => call(`keyboard.type(${JSON.stringify(text)})`),
    // Page state: focus inside the root shows on the host, as for page code.
    hostFocused: () =>
      mode === "native"
        ? expect(page.locator("#host")).toBeFocused({ timeout: 500 })
        : page.evaluate(() =>
            __pl
              .expect((window.__plPage ??= __pl.createPage()).locator("#host"))
              .toBeFocused({ timeout: 500 })
          ),
    async state() {
      const pageState = await page.evaluate(() => {
        const label = (n) => (n ? (n.id ? `#${n.id}` : n.localName) : null);
        return {
          activeElement: label(document.activeElement),
          rootActive: label(__fixture.root.activeElement),
          field: __fixture.root.getElementById("field").value,
          hostShadowRoot: document.getElementById("host").shadowRoot,
        };
      });
      const locatorState =
        mode === "native"
          ? {
              innerCount: await page.locator("#inner").count(),
              byRole: await page.getByRole("button").count(),
              aria: await page.locator("body").ariaSnapshot(),
            }
          : await page.evaluate(async () => {
              const p = (window.__plPage ??= __pl.createPage());
              return {
                innerCount: await p.locator("#inner").count(),
                byRole: await p.getByRole("button").count(),
                aria: await p.locator("body").ariaSnapshot(),
              };
            });
      return { ...pageState, ...locatorState };
    },
  };
}

async function inputScenario(browser, mode, early) {
  const init = mode === "native" || !early ? [] : [adapterInit];
  return withPage(browser, init, inputFixture, async (page) => {
    if (mode !== "native" && !early)
      await page.addScriptTag({ content: adapterInit });
    const d = driver(page, mode);
    const steps = [
      ["mouse.click(60, 30) on #inner", () => d.click(60, 30)],
      ["mouse.click(85, 85) on #field", () => d.click(85, 85)],
      ['keyboard.type("abc")', () => d.type("abc")],
      ['expect(locator("#host")).toBeFocused()', () => d.hostFocused()],
      ['locator("#host").click() (centre is #field)', () => d.clickHost()],
      ['keyboard.type("d")', () => d.type("d")],
      ["mouse.click(220, 30) on nested #deep", () => d.click(220, 30)],
      ["mouse.click(50, 220) on #outside", () => d.click(50, 220)],
    ];
    const out = [];
    for (const [name, step] of steps) {
      await page.evaluate(() => (window.__log = []));
      let error;
      await step().catch((e) => (error = String(e.message).split("\n")[0]));
      out.push({
        step: name,
        error,
        events: await page.evaluate(() => window.__log),
      });
    }
    return { steps: out, final: await d.state() };
  });
}

async function captureScenario(browser, mode, early) {
  const init = mode === "native" || !early ? [] : [adapterInit];
  return withPage(browser, init, captureFixture, async (page) => {
    // A root another world attaches, the way an extension's content script would.
    const cdp = await page.context().newCDPSession(page);
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "probe-isolated-world",
    });
    await cdp.send("Runtime.evaluate", {
      contextId: executionContextId,
      expression: `document.getElementById("isolatedWorld").attachShadow({ mode: "closed" }).innerHTML =
        '<button style="width:100px;height:30px" onclick="__hits.push(\\'isolatedWorld\\')">isolatedWorld</button>'`,
    });
    if (mode !== "native" && !early)
      await page.addScriptTag({ content: adapterInit });
    await page.evaluate(() => {
      afterLoad.attachShadow({ mode: "closed" }).innerHTML =
        __button("afterLoad");
    });
    const hosts = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "body > div, body > x-el, body > x-hydrate"
        ),
      ].map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.id, x: r.x + 50, y: r.y + 15 };
      })
    );
    const result = {};
    for (const { id, x, y } of hosts) {
      await page.evaluate(() => (window.__hits = []));
      if (mode === "native") await page.mouse.click(x, y);
      else
        await page.evaluate(
          ([x, y]) => (window.__plPage ??= __pl.createPage()).mouse.click(x, y),
          [x, y]
        );
      const hits = await page.evaluate(() => window.__hits);
      result[id] = hits.includes(id) ? "reached" : "host only";
    }
    // Can a script tell a closed host from a plain element without side effects?
    result.detection = await page.evaluate(() => {
      const attempt = (el, init) => {
        try {
          el.attachShadow(init);
          return "attached!";
        } catch (e) {
          return e.name;
        }
      };
      const plain = document.createElement("div");
      return {
        closedHostBogusMode: attempt(inlineScript, { mode: "bogus" }),
        plainBogusMode: attempt(plain, { mode: "bogus" }),
        closedHostShadowRoot: inlineScript.shadowRoot,
        serializableGetHTML: declarativeSerializable
          .getHTML({ serializableShadowRoots: true })
          .includes("<button"),
        internalsShadowRoot: !!window.__internals.shadowRoot,
        attachShadowLooksNative: String(
          Element.prototype.attachShadow
        ).includes("[native code]"),
      };
    });
    return result;
  });
}

// A custom selector engine that reaches into the fixture's closed root, the way
// a consumer that owns its root (Ayme's Inspector) tests it. The action then
// knows its target element, so no root has to be discovered.
const fixtureEngine = () => ({
  query: (_root, selector) =>
    window.__fixture?.root.querySelector(selector) ?? null,
  queryAll: (_root, selector) => [
    ...(window.__fixture?.root.querySelectorAll(selector) ?? []),
  ],
});

async function knownTargetScenario(browser, mode) {
  return withPage(browser, [], inputFixture, async (page) => {
    if (mode !== "native") {
      await page.addScriptTag({ content: adapterInit });
      await page.evaluate(
        (source) => __pl.selectors.register("fixture", source),
        `(${fixtureEngine})()`
      );
    }
    const call = (expression) =>
      mode === "native"
        ? new Function("page", `return page.${expression}`)(page)
        : page.evaluate(
            `(window.__plPage ??= __pl.createPage()).${expression}`
          );
    const steps = [
      'locator("fixture=#inner").click()',
      'locator("fixture=#field").fill("xy")',
      'locator("fixture=#field").pressSequentially("z")',
      'locator("fixture=#field").press("Backspace")',
    ];
    const out = [];
    for (const step of steps) {
      await page.evaluate(() => (window.__log = []));
      let error;
      await call(step).catch((e) => (error = String(e.message).split("\n")[0]));
      const events = await page.evaluate(() => window.__log);
      out.push({
        step,
        error,
        insideEvents: events.filter((e) => e.startsWith("root")).length,
        outsideTargets: [
          ...new Set(
            events
              .filter((e) => e.startsWith("outside"))
              .map((e) => e.split(" ").slice(1, 3).join(" "))
          ),
        ],
      });
    }
    const field = await page.evaluate(
      () => __fixture.root.getElementById("field").value
    );
    return { steps: out, field };
  });
}

/** How the prototype's hook coexists with page wrappers and other copies. */
async function coexistenceScenario(browser) {
  const fixture = `<!doctype html><style>body{margin:0}</style>
    <div id=host style="width:120px;height:40px"></div>
    <script>
      const pageOriginal = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) { window.__pageWrapperCalls++; return pageOriginal.call(this, init); };
      host.attachShadow({ mode: "closed" }).innerHTML =
        '<button style="width:100px;height:30px" onclick="__hits.push(1)">x</button>';
    </script>`;
  const counter = `window.__hits = []; window.__pageWrapperCalls = 0; window.__nativeCalls = 0;
    const native = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { window.__nativeCalls++; return native.call(this, init); };`;
  const cases = {
    "two runtime copies, page wraps after them": [
      counter,
      adapterInit,
      adapterInit,
    ],
    "frozen Element.prototype before load": [
      `${counter} Object.freeze(Element.prototype);`,
      adapterInit,
    ],
  };
  const result = {};
  for (const [name, init] of Object.entries(cases))
    result[name] = await withPage(browser, init, fixture, (page) =>
      page.evaluate(async () => {
        let error = null;
        try {
          await (window.__plPage ??= __pl.createPage()).mouse.click(50, 15);
        } catch (e) {
          error = e.message;
        }
        return {
          reached: window.__hits.length === 1,
          nativeCalls: window.__nativeCalls,
          pageWrapperCalls: window.__pageWrapperCalls,
          error,
        };
      })
    );
  return result;
}

// PROBE_CHROMIUM points at a Chromium when the pinned browser is not installed.
await selectors.register("fixture", fixtureEngine);
const browser = await chromium.launch({
  executablePath: process.env.PROBE_CHROMIUM || undefined,
});
try {
  const report = {
    adapter: distDir,
    input: {
      native: await inputScenario(browser, "native"),
      adapterLoadedLate: await inputScenario(browser, "adapter", false),
      adapterLoadedEarly: await inputScenario(browser, "adapter", true),
    },
    capture: {
      native: await captureScenario(browser, "native"),
      adapterLoadedLate: await captureScenario(browser, "adapter", false),
      adapterLoadedEarly: await captureScenario(browser, "adapter", true),
    },
    knownTarget: {
      native: await knownTargetScenario(browser, "native"),
      adapter: await knownTargetScenario(browser, "adapter"),
    },
    coexistence: await coexistenceScenario(browser),
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
