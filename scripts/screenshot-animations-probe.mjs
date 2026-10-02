// Diagnostic probe for issue #257, not a contract test and not compatibility
// evidence. It measures how SnapDOM 3.2.0 renders documents after Playwright's
// pinned screenshot preparation (`inPagePrepareForScreenshots`, animations:
// "disabled"), and whether dropping the cloned author stylesheets fixes the
// mismatch. Native Playwright captures are feasibility references only.
//
//   node scripts/screenshot-animations-probe.mjs [--json out.json] [--only <id>]
//
// Environment:
//   SNAPDOM_DIST      path to @zumer/snapdom 3.2.0 dist/snapdom.js. When unset,
//                     the package is installed into the OS temp directory.
//   PROBE_CHROMIUM    Chromium executable, when Playwright's own is not installed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const only = flag("--only");
const jsonOut = flag("--json");

function snapdomDist() {
  if (process.env.SNAPDOM_DIST) return process.env.SNAPDOM_DIST;
  const prefix = join(tmpdir(), "playwright-lite-snapdom-3.2.0");
  const dist = join(prefix, "node_modules/@zumer/snapdom/dist/snapdom.js");
  if (!existsSync(dist)) {
    mkdirSync(prefix, { recursive: true });
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "@zumer/snapdom@3.2.0",
      ],
      { stdio: "inherit" }
    );
  }
  return dist;
}

// The pinned function, exactly as Playwright injects it: `'(' + fn.toString() + ')(...)'`.
function pinnedPreparation() {
  const require = createRequire(import.meta.url);
  const bundle = readFileSync(
    join(
      require.resolve("playwright-core/package.json"),
      "../lib/coreBundle.js"
    ),
    "utf8"
  );
  const start = bundle.indexOf("function inPagePrepareForScreenshots(");
  let depth = 0;
  for (let i = bundle.indexOf("{", start); i < bundle.length; i++) {
    if (bundle[i] === "{") depth++;
    if (bundle[i] === "}" && --depth === 0) return bundle.slice(start, i + 1);
  }
  throw new Error("inPagePrepareForScreenshots not found in playwright-core");
}

const snapdomSource = readFileSync(snapdomDist(), "utf8");
const preparationSource = pinnedPreparation();

// Variants differ only in how the capture treats author CSS carried into the clone.
//   default  SnapDOM as the prototype used it.
//   head     the documented `exclude` option dropping <head> from the clone.
//   strip    per-capture afterClone plugin removing every <style> and stylesheet
//            <link> from the clone. The generated computed-style classes stay.
//   full     strip, plus re-resolving, on each clone element, the inline
//            declarations of properties an Animation currently animates on its
//            source element to the source's computed value (the way SnapDOM's own
//            normalizeInlineStyleToComputed treats !important). Both use only
//            documented plugin context (`clone`, `nodeMap`).
const VARIANTS = ["default", "head", "strip", "full"];
const variantOptions = `(variant) => {
  if (variant === "head") return { exclude: ["head"], excludeMode: "remove" };
  if (variant !== "strip" && variant !== "full") return {};
  const roots = (root, out = [root]) => {
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots(el.shadowRoot, out);
    return out;
  };
  const META = new Set(["offset", "easing", "composite", "computedOffset"]);
  return { plugins: [{ name: "pwlite-" + variant, afterClone(ctx) {
    ctx.clone.querySelectorAll("style, link[rel~=stylesheet]").forEach((n) => n.remove());
    if (variant !== "full") return;
    const animated = new Map();
    for (const root of roots(document)) for (const animation of root.getAnimations()) {
      const target = animation.effect?.target;
      if (!target || animation.effect.pseudoElement) continue;
      const set = animated.get(target) ?? new Set();
      for (const frame of animation.effect.getKeyframes())
        for (const key of Object.keys(frame)) if (!META.has(key)) set.add(key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
      animated.set(target, set);
    }
    for (const [cloned, source] of ctx.nodeMap) {
      const props = animated.get(source);
      if (!props || !cloned.style?.length) continue;
      const computed = getComputedStyle(source);
      for (const prop of props)
        if (cloned.style.getPropertyValue(prop) !== "")
          cloned.style.setProperty(prop, computed.getPropertyValue(prop), cloned.style.getPropertyPriority(prop));
    }
  } }] };
}`;

const css = (body) => `<style>html,body{margin:0}${body}</style>`;
const BOX = "position:absolute;left:20px;top:20px;width:100px;height:100px;";
const WAAPI_FILL = `document.querySelector("#t").animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000,fill:"forwards"})`;
const CSS_FILL_KEYFRAMES = `@keyframes to-green{from{background:#e84848}to{background:#00ff00}}`;

// group "animation": prepared with animations: "disabled".
// group "regression": no animation involved; checks that dropping the cloned
// author stylesheets changes nothing the computed-style snapshot should own.
const scenarios = [
  {
    id: "retained-fixture",
    group: "animation",
    title:
      "Prototype fixture: stylesheet #target, WAAPI finite fill, infinite WAAPI on the cover",
    viewport: { width: 900, height: 700 },
    html: css(
      `body{min-height:1800px}#target{position:absolute;left:80px;top:340px;width:220px;height:140px;background:#e84848;border-radius:12px}#cover{position:absolute;left:180px;top:380px;width:100px;height:60px;background:#164cde;z-index:2}`
    ).concat(`<div id=target></div><div id=cover></div>`),
    setup: `document.querySelector("#target").animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000,fill:"forwards"});
      document.querySelector("#cover").animate([{background:"#164cde"},{background:"#ffff00"}],{duration:60000,iterations:Infinity});`,
    clip: { x: 80, y: 340, width: 220, height: 140 },
    probe: [
      [20, 20],
      [110, 70],
    ],
  },
  {
    id: "waapi-finite-fill-id",
    group: "animation",
    title: "WAAPI finite, fill forwards, base from #id rule",
    html: css(`#t{${BOX}background:#e84848}`) + `<div id=t></div>`,
    setup: WAAPI_FILL,
  },
  {
    id: "waapi-finite-fill-class",
    group: "animation",
    title: "WAAPI finite, fill forwards, base from .class rule",
    html: css(`.t{${BOX}background:#e84848}`) + `<div id=t class=t></div>`,
    setup: WAAPI_FILL,
  },
  {
    id: "waapi-finite-fill-tag",
    group: "animation",
    title: "WAAPI finite, fill forwards, base from tag rule",
    html: css(`div{${BOX}background:#e84848}`) + `<div id=t></div>`,
    setup: WAAPI_FILL,
  },
  {
    id: "waapi-finite-fill-inline",
    group: "animation",
    title: "WAAPI finite, fill forwards, base from inline style",
    html: css(`#t{${BOX}}`) + `<div id=t style="background:#e84848"></div>`,
    setup: WAAPI_FILL,
  },
  {
    id: "waapi-inline-multi",
    group: "animation",
    title:
      "WAAPI finite fill on several inline-authored properties (background, opacity, transform, width)",
    html:
      css(`#t{position:absolute;left:20px;top:20px;height:100px}`) +
      `<div id=t style="background:#e84848;opacity:1;width:100px"></div>`,
    setup: `document.querySelector("#t").animate([{background:"#e84848",opacity:1,transform:"none",width:"100px"},{background:"#00ff00",opacity:0.5,transform:"translateX(20px)",width:"60px"}],{duration:60000,fill:"forwards"})`,
    probe: [
      [70, 50],
      [30, 50],
    ],
  },
  {
    id: "waapi-inline-more",
    group: "animation",
    title:
      "WAAPI finite fill on inline-authored border-color, box-shadow, margin-left, border-radius, height",
    html:
      css(`#t{position:absolute;left:20px;top:20px;width:80px}`) +
      `<div id=t style="border:6px solid #e84848;box-shadow:0 0 0 0 #164cde;margin-left:0;border-radius:0;height:80px;background:#ddd"></div>`,
    setup: `document.querySelector("#t").animate([{borderColor:"#e84848",boxShadow:"0 0 0 0 #164cde",marginLeft:"0px",borderRadius:"0px",height:"80px"},{borderColor:"#00ff00",boxShadow:"10px 10px 0 0 #164cde",marginLeft:"15px",borderRadius:"30px",height:"60px"}],{duration:60000,fill:"forwards"})`,
    clip: { x: 0, y: 0, width: 160, height: 140 },
    probe: [[22, 40]],
  },
  {
    id: "waapi-finite-fill-important",
    group: "animation",
    title:
      "WAAPI finite, fill forwards, base !important (author wins live too)",
    html: css(`#t{${BOX}background:#e84848 !important}`) + `<div id=t></div>`,
    setup: WAAPI_FILL,
  },
  {
    id: "waapi-finite-nofill",
    group: "animation",
    title: "WAAPI finite, no fill: finishing reverts to the base value",
    html: css(`#t{${BOX}background:#e84848}`) + `<div id=t></div>`,
    setup: `document.querySelector("#t").animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000})`,
  },
  {
    id: "waapi-infinite",
    group: "animation",
    title: "WAAPI infinite colour animation: cancelled, base value shows",
    html: css(`#t{${BOX}background:#e84848}`) + `<div id=t></div>`,
    setup: `document.querySelector("#t").animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000,iterations:Infinity})`,
  },
  {
    id: "css-finite-fill",
    group: "animation",
    title: "CSS @keyframes finite, fill forwards",
    html:
      css(
        `#t{${BOX}background:#e84848;animation:to-green 60s forwards}${CSS_FILL_KEYFRAMES}`
      ) + `<div id=t></div>`,
  },
  {
    id: "css-finite-nofill",
    group: "animation",
    title: "CSS @keyframes finite, no fill",
    html:
      css(
        `#t{${BOX}background:#e84848;animation:to-green 60s}${CSS_FILL_KEYFRAMES}`
      ) + `<div id=t></div>`,
  },
  {
    id: "css-infinite-rotate",
    group: "animation",
    title: "CSS infinite rotation (pinned rotate-z shape)",
    html:
      css(
        `#t{${BOX}background:#e84848;animation:spin 5s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`
      ) + `<div id=t></div>`,
    setup: `await new Promise((r) => setTimeout(r, 1200))`,
  },
  {
    id: "css-transition-finish",
    group: "animation",
    title:
      "CSS transition in flight, finished by preparation (pinned css-transition shape)",
    html:
      css(
        `#t{${BOX}background:#e84848;transition:all 60s}#t.on{background:#00ff00}`
      ) + `<div id=t></div>`,
    setup: `document.querySelector("#t").getBoundingClientRect(); document.querySelector("#t").classList.add("on")`,
  },
  {
    id: "css-transition-allow",
    group: "animation",
    animations: "allow",
    title:
      "CSS transition in flight, animations allow (no preparation): native shows the in-flight value",
    html:
      css(
        `#t{${BOX}background:#e84848;transition:all 600s}#t.on{background:#00ff00}`
      ) + `<div id=t></div>`,
    setup: `document.querySelector("#t").getBoundingClientRect(); document.querySelector("#t").classList.add("on"); await new Promise((r) => setTimeout(r, 300))`,
  },
  {
    id: "css-transition-allow-inline",
    group: "animation",
    animations: "allow",
    title:
      "CSS transition triggered by an inline style write, in flight, animations allow",
    html:
      css(`#t{${BOX}background:#e84848;transition:all 600s}`) +
      `<div id=t></div>`,
    setup: `const el = document.querySelector("#t"); el.getBoundingClientRect(); el.style.background = "#00ff00"; await new Promise((r) => setTimeout(r, 300))`,
  },
  {
    id: "css-pseudo-finite-fill",
    group: "animation",
    title: "CSS finite fill-forwards animation on ::after",
    html:
      css(
        `#t{${BOX}}#t::after{content:" ";position:absolute;inset:0;background:#e84848;animation:to-green 60s forwards}${CSS_FILL_KEYFRAMES}`
      ) + `<div id=t></div>`,
  },
  {
    id: "shadow-finite-fill",
    group: "animation",
    title: "WAAPI finite fill-forwards inside an open shadow root",
    html: css(``) + `<div id=host></div>`,
    setup: `const root = document.querySelector("#host").attachShadow({ mode: "open" });
      root.innerHTML = '<style>div{position:absolute;left:20px;top:20px;width:100px;height:100px;background:#e84848}</style><div id=t></div>';
      root.querySelector("#t").animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000,fill:"forwards"})`,
  },
  // —— static regression matrix ——
  {
    id: "static-pseudo",
    group: "regression",
    title: "::before/::after content and colours",
    html:
      css(
        `#t{${BOX}background:#ddd}#t::before{content:"";position:absolute;left:0;top:0;width:50px;height:50px;background:#164cde}#t::after{content:"";position:absolute;right:0;bottom:0;width:50px;height:50px;background:#e84848}`
      ) + `<div id=t></div>`,
  },
  {
    id: "static-structural",
    group: "regression",
    title: ":nth-child, attribute, :has(), :is() and :not() rules",
    html:
      css(
        `ul{margin:0;padding:0;list-style:none}li{width:40px;height:40px;background:#ddd}li:nth-child(2){background:#164cde}li[data-k]{background:#e84848}ul:has(li[data-k]) li:last-child{background:#00ff00}:is(li):not(:first-child){border:2px solid #000}`
      ) + `<ul id=t><li></li><li></li><li data-k></li><li></li></ul>`,
    clip: { x: 0, y: 0, width: 60, height: 170 },
  },
  {
    id: "static-checked",
    group: "regression",
    title: ":checked + label sibling rule",
    html:
      css(
        `#t{${BOX}}input{position:absolute;opacity:0}input:checked+label{display:block;width:100px;height:100px;background:#00ff00}label{display:block;width:100px;height:100px;background:#e84848}`
      ) + `<div id=t><input type=checkbox checked><label>x</label></div>`,
  },
  {
    id: "static-media",
    group: "regression",
    title: "@media (min-width) rule with a clip smaller than the viewport",
    viewport: { width: 800, height: 600 },
    html:
      css(
        `#t{${BOX}background:#e84848}@media (min-width:500px){#t{background:#164cde}}@media (max-width:300px){#t{background:#00ff00}}`
      ) + `<div id=t></div>`,
  },
  {
    id: "static-container-supports",
    group: "regression",
    title: "@container and @supports rules",
    html:
      css(
        `#w{container-type:inline-size;position:absolute;left:20px;top:20px;width:300px}#t{height:100px;width:100px;background:#e84848}@container (min-width:200px){#t{background:#164cde}}@supports (display:grid){#t{outline:4px solid #00ff00}}`
      ) + `<div id=w><div id=t></div></div>`,
  },
  {
    id: "static-custom-properties",
    group: "regression",
    title: ":root custom properties through var()",
    html:
      css(`:root{--c:#164cde}#t{${BOX}background:var(--c)}`) +
      `<div id=t></div>`,
  },
  {
    id: "static-body-style",
    group: "regression",
    title: "<style> element in the body, after its target",
    html: `<div id=t></div><style>html,body{margin:0}#t{${BOX}background:#164cde}</style>`,
  },
  {
    id: "static-screenshot-style",
    group: "regression",
    title:
      "pinned `style` option (temporary <style> appended to documentElement)",
    html: css(`#t{${BOX}background:#e84848}`) + `<div id=t></div>`,
    style: "#t{background:#00ff00 !important}",
  },
  {
    id: "static-screenshot-style-shadow",
    group: "regression",
    title: "pinned `style` option reaching an open shadow root",
    html: css(``) + `<div id=host></div>`,
    setup: `document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML = '<div id=t style="position:absolute;left:20px;top:20px;width:100px;height:100px;background:#e84848"></div>'`,
    style: "#t{background:#00ff00 !important}",
  },
  {
    id: "static-caret-hide",
    group: "regression",
    title: "pinned caret hiding on a focused input",
    html:
      css(
        `#t{position:absolute;left:20px;top:20px;width:100px;height:40px;caret-color:red !important}`
      ) + `<input id=t value="Caret">`,
    setup: `const i = document.querySelector("#t"); i.focus(); i.setSelectionRange(0, 0)`,
  },
];

const DEFAULT_CLIP = { x: 0, y: 0, width: 140, height: 140 };

// Runs in the page: the SnapDOM side of one measurement.
const pageCapture = `async ({ scenario, variant, prepared, preparationSource, variantOptionsSource }) => {
  const live = () => ({
    background: getComputedStyle(document.querySelector("#t") || document.querySelector("#target") || document.body).backgroundColor,
  });
  if (scenario.setup) await (new Function("return (async () => {" + scenario.setup + "})()")).call(window);
  let cleanup = () => {};
  if (prepared) {
    (0, eval)("(" + preparationSource + ")(" + JSON.stringify(scenario.style ?? "") + ", true, true, false)");
    cleanup = () => window.__pwCleanupScreenshot && window.__pwCleanupScreenshot();
  }
  const liveAfterPreparation = live();
  const clip = scenario.clip;
  const options = (0, eval)("(" + variantOptionsSource + ")")(variant);
  const result = await snapdom(document.documentElement, { clip, dpr: 1, backgroundColor: "#ffffff", cache: "disabled", invalidate: true, ...options });
  const blob = await result.toBlob({ format: "png", backgroundColor: "#ffffff" });
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  cleanup();
  return { bytes, warnings: result.warnings, liveAfterPreparation };
}`;

async function newPage(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport ?? { width: 400, height: 300 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setContent(scenario.html);
  return { page, context };
}

async function decodeDiff(page, a, b, probe) {
  return page.evaluate(
    async ({ a, b, probe }) => {
      const decode = async (data) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(data)], { type: "image/png" })
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
        };
      };
      const [x, y] = [await decode(a), await decode(b)];
      if (x.width !== y.width || x.height !== y.height)
        return { sizeMismatch: [x.width, x.height, y.width, y.height] };
      let different = 0;
      for (let i = 0; i < x.data.length; i += 4)
        for (let c = 0; c < 3; c++)
          if (Math.abs(x.data[i + c] - y.data[i + c]) > 24) {
            different++;
            break;
          }
      const at = (img, px, py) =>
        Array.from(img.data.slice((py * img.width + px) * 4).slice(0, 3));
      const points = probe ?? [
        [Math.floor(x.width / 2), Math.floor(x.height / 2)],
      ];
      return {
        differentPercent:
          Math.round((different / (x.width * x.height)) * 10000) / 100,
        samples: points.map(([px, py]) => ({
          at: [px, py],
          a: at(x, px, py),
          b: at(y, px, py),
        })),
      };
    },
    { a, b, probe }
  );
}

const hex = (rgb) =>
  "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

const launchOptions = process.env.PROBE_CHROMIUM
  ? { executablePath: process.env.PROBE_CHROMIUM }
  : {};
const browser = await chromium.launch(launchOptions);
const results = [];

try {
  const scratch = await (await browser.newContext()).newPage();
  for (const scenario of scenarios) {
    if (only && scenario.id !== only) continue;
    scenario.clip ??= DEFAULT_CLIP;
    const prepared = (scenario.animations ?? "disabled") === "disabled";
    // Native reference: Playwright's own capture of the same fixture.
    const native = await newPage(browser, scenario);
    if (scenario.setup)
      await native.page.evaluate(`(async () => {${scenario.setup}})()`);
    const nativeBytes = await native.page.screenshot({
      clip: scenario.clip,
      animations: prepared ? "disabled" : "allow",
      style: scenario.style,
    });
    await native.context.close();

    const bytesByVariant = {};
    const row = {
      id: scenario.id,
      group: scenario.group,
      title: scenario.title,
      variants: {},
    };
    for (const variant of VARIANTS) {
      const { page, context } = await newPage(browser, scenario);
      await page.addScriptTag({ content: snapdomSource });
      const captured = await page.evaluate(
        `(${pageCapture})`.concat(
          `(${JSON.stringify({
            scenario: {
              setup: scenario.setup,
              style: scenario.style,
              clip: scenario.clip,
            },
            variant,
            prepared,
            preparationSource,
            variantOptionsSource: variantOptions,
          })})`
        )
      );
      await context.close();
      const diff = await decodeDiff(
        scratch,
        Array.from(nativeBytes),
        captured.bytes,
        scenario.probe
      );
      bytesByVariant[variant] = captured.bytes;
      row.variants[variant] = {
        differentPercentFromNative: diff.differentPercent ?? null,
        sizeMismatch: diff.sizeMismatch,
        samples: diff.samples?.map((s) => ({
          at: s.at,
          native: hex(s.a),
          snapdom: hex(s.b),
        })),
        warnings: captured.warnings,
        liveAfterPreparation: captured.liveAfterPreparation.background,
      };
    }
    // What the correction changes relative to the unmodified capture.
    row.fullVersusDefaultDifferentPercent = (
      await decodeDiff(scratch, bytesByVariant.default, bytesByVariant.full)
    ).differentPercent;
    results.push(row);
    const cell = (v) => {
      const r = row.variants[v];
      const s = r.samples?.[0];
      return `${v}: ${s ? `${s.snapdom} (native ${s.native})` : "size mismatch"} ${r.differentPercentFromNative ?? "?"}%`;
    };
    console.log(
      `${scenario.group.padEnd(10)} ${scenario.id.padEnd(32)} ${VARIANTS.map(cell).join(" | ")} | full vs default ${row.fullVersusDefaultDifferentPercent}%`
    );
  }

  // Stage inspection on the retained fixture shape: separate the computed-style
  // snapshot, the generated SVG and its rasterisation.
  if (!only || only === "stages") {
    const scenario = scenarios.find((s) => s.id === "waapi-finite-fill-id");
    const { page, context } = await newPage(browser, scenario);
    await page.addScriptTag({ content: snapdomSource });
    const stages = await page.evaluate(
      async ({ preparationSource, setup }) => {
        await new Function("return (async () => {" + setup + "})()").call(
          window
        );
        (0, eval)("(" + preparationSource + ')("", true, true, false)');
        const liveComputed = getComputedStyle(
          document.querySelector("#t")
        ).backgroundColor;
        const result = await snapdom(document.documentElement, {
          cache: "disabled",
        });
        const raw = await result.toRaw();
        window.__pwCleanupScreenshot();
        const svg = decodeURIComponent(raw.split(",").slice(1).join(","));
        const rasterise = async (markup) => {
          const image = new Image();
          image.src =
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
          await image.decode();
          const canvas = new OffscreenCanvas(400, 300);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(70, 70, 1, 1).data.slice(0, 3));
        };
        const generated =
          svg.match(/\.c\d+\{[^}]*background-color:[^;}]+/g) ?? [];
        const head = svg.match(/<head[^>]*>.*?<\/head>/s)?.[0] ?? null;
        return {
          liveComputed,
          generatedClassBackground: generated.map((g) =>
            g.replace(/\{.*?(background-color:[^;}]+).*/s, "{… $1")
          ),
          clonedHead: head,
          rasterWithClonedHead: await rasterise(svg),
          rasterWithoutClonedStyle: await rasterise(
            svg.replace(/<style>[^<]*<\/style>(?=<\/head>)/, "")
          ),
        };
      },
      { preparationSource, setup: scenario.setup }
    );
    await context.close();
    results.push({ id: "stages", stages });
    console.log("stages", JSON.stringify(stages, null, 2));
  }

  // Preparation semantics with a capture in the middle: finish events, cancel
  // events and the restart of infinite animations at cleanup.
  if (!only || only === "events") {
    const events = await (async () => {
      const out = {};
      const run = async (name, html, setup) => {
        out[name] = {};
        for (const withCapture of [false, true]) {
          const { page, context } = await newPage(browser, { html });
          await page.addScriptTag({ content: snapdomSource });
          out[name][withCapture ? "withCapture" : "prepareOnly"] =
            await page.evaluate(
              async ({
                preparationSource,
                setup,
                withCapture,
                variantOptionsSource,
              }) => {
                window._EVENTS = [];
                const el = document.querySelector("#t");
                await new Function(
                  "el",
                  "return (async () => {" + setup + "})()"
                ).call(window, el);
                (0, eval)("(" + preparationSource + ')("", true, true, false)');
                if (withCapture)
                  await snapdom(document.documentElement, {
                    cache: "disabled",
                    invalidate: true,
                    ...(0, eval)("(" + variantOptionsSource + ")")("full"),
                  }).then((r) => r.toBlob({ format: "png" }));
                await new Promise((r) => setTimeout(r, 100));
                const during = el.getAnimations().map((a) => a.playState);
                window.__pwCleanupScreenshot();
                await new Promise((r) => setTimeout(r, 100));
                return {
                  events: window._EVENTS,
                  playStatesBeforeCleanup: during,
                  playStatesAfterCleanup: el
                    .getAnimations()
                    .map((a) => a.playState),
                };
              },
              {
                preparationSource,
                setup,
                withCapture,
                variantOptionsSource: variantOptions,
              }
            );
          await context.close();
        }
      };
      const base = (extra) =>
        css(
          `#t{${BOX}background:#e84848;${extra}}@keyframes spin{to{transform:rotate(360deg)}}`
        ) + `<div id=t></div>`;
      const listen = `const a = el.getAnimations()[0]; a.oncancel = () => window._EVENTS.push("oncancel"); a.onfinish = () => window._EVENTS.push("onfinish");`;
      await run(
        "css-transition",
        base("transition:all 600s") + "",
        `el.getBoundingClientRect(); el.style.background = "#00ff00"; el.addEventListener("transitionend", () => window._EVENTS.push("transitionend")); ${listen} await a.ready`
      );
      await run(
        "css-animation-infinite",
        base("animation:spin 5s linear infinite"),
        `el.addEventListener("animationcancel", () => window._EVENTS.push("animationcancel")); ${listen} await a.ready`
      );
      await run(
        "css-animation-finite",
        base("animation:spin 5s linear 1000"),
        `el.addEventListener("animationend", () => window._EVENTS.push("animationend")); ${listen} await a.ready`
      );
      await run(
        "waapi-finite-fill",
        base(""),
        `const a = el.animate([{background:"#e84848"},{background:"#00ff00"}],{duration:60000,fill:"forwards"}); a.onfinish = () => window._EVENTS.push("onfinish"); await a.ready`
      );
      await run(
        "waapi-infinite",
        base(""),
        `const a = el.animate([{transform:"rotate(0)"},{transform:"rotate(360deg)"}],{duration:3000,iterations:Infinity}); a.oncancel = () => window._EVENTS.push("oncancel"); await a.ready`
      );
      return out;
    })();
    results.push({ id: "events", events });
    console.log("events", JSON.stringify(events, null, 2));
  }
  // Lifecycle of the pinned preparation, independent of the renderer: the
  // cleanup lives in one `window.__pwCleanupScreenshot` slot, which Playwright
  // owns per page but this package would share across Page instances. Every
  // case gets a fresh document, because a lost cleanup leaks listeners.
  if (!only || only === "lifecycle") {
    const fixture =
      css(
        `#t{${BOX}background:#e84848;animation:spin 5s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`
      ) + `<div id=t></div>`;
    const cases = {
      // Two preparations before either cleanup, as two Page instances capturing
      // concurrently would produce. The second overwrites the first's slot.
      overlapSharedSlot: `
        prepare(STYLE); prepare(STYLE);
        window.__pwCleanupScreenshot();`,
      // Same overlap, each cleanup read into a closure right after its
      // preparation, then run in reverse order.
      overlapOwnedCleanups: `
        prepare(STYLE);
        const first = window.__pwCleanupScreenshot; delete window.__pwCleanupScreenshot;
        prepare(STYLE);
        const second = window.__pwCleanupScreenshot; delete window.__pwCleanupScreenshot;
        second(); first();`,
      // The capture rejects; the finally block still restores.
      errorPath: `
        prepare(STYLE);
        try {
          await snapdom(document.documentElement, { cache: "disabled", plugins: [{ name: "boom", afterClone() { throw new Error("boom"); } }] });
        } catch (error) { result.rejected = String(error.message ?? error); }
        finally { window.__pwCleanupScreenshot(); }`,
      // The caller stops waiting and cleanup runs while the renderer is still
      // working. SnapDOM has no cancellation.
      abortPath: `
        prepare(STYLE);
        const pending = snapdom(document.documentElement, { cache: "disabled", invalidate: true }).then((r) => r.toBlob({ format: "png" }));
        window.__pwCleanupScreenshot();
        const late = await pending;
        result.rendererResolvedAfterCleanup = late instanceof Blob && late.size > 0;`,
      // Ordinary capture: what the renderer leaves in the host document.
      hostMarkup: `
        const serialise = () => document.documentElement.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/g, "");
        const before = serialise();
        prepare("");
        await snapdom(document.documentElement, { cache: "disabled", invalidate: true }).then((r) => r.toBlob({ format: "png" }));
        window.__pwCleanupScreenshot();
        await wait(50);
        result.hostMarkupChanged = serialise() !== before;
        result.rendererIframesLeft = document.querySelectorAll("iframe[data-snapdom-internal]").length;
        document.querySelectorAll("iframe[data-snapdom-internal]").forEach((n) => n.remove());
        result.hostMarkupChangedExceptRendererIframe = serialise() !== before;`,
    };
    const lifecycle = {};
    for (const [name, body] of Object.entries(cases)) {
      const { page, context } = await newPage(browser, { html: fixture });
      await page.addScriptTag({ content: snapdomSource });
      lifecycle[name] = await page.evaluate(
        async ({ preparationSource, body }) => {
          const STYLE = "#t{outline:3px solid #00f}";
          const prepare = (style) =>
            (0, eval)(
              "(" +
                preparationSource +
                ")(" +
                JSON.stringify(style) +
                ", true, true, false)"
            );
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const el = document.querySelector("#t");
          const result = {};
          await wait(100);
          await new Function(
            "prepare",
            "STYLE",
            "snapdom",
            "result",
            "wait",
            "return (async () => {" + body + "})()"
          )(prepare, STYLE, snapdom, result, wait);
          await wait(100);
          return {
            ...result,
            infiniteAnimation: el.getAnimations().map((a) => a.playState),
            temporaryStyleElements: [
              ...document.querySelectorAll("style"),
            ].filter((n) => n.textContent.includes("outline")).length,
            cleanupSlot: typeof window.__pwCleanupScreenshot,
          };
        },
        { preparationSource, body }
      );
      await context.close();
    }
    results.push({ id: "lifecycle", lifecycle });
    console.log("lifecycle", JSON.stringify(lifecycle, null, 2));
  }
} finally {
  await browser.close();
}

if (jsonOut)
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        snapdom: "3.2.0",
        playwright: createRequire(import.meta.url)("playwright/package.json")
          .version,
        chromium: browser.version?.() ?? undefined,
        note: "Diagnostic measurements; native Playwright is a feasibility reference, not adapter compatibility evidence.",
        results,
      },
      null,
      2
    ) + "\n"
  );
