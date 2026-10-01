// Throwaway diagnostic runner, not a contract test or compatibility evidence.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "output/playwright/screenshot-prototype");
await mkdir(output, { recursive: true });
let imageBytes;
const html = await readFile(resolve(root, "src/screenshot.prototype.html"));
const serve = async () => {
  const server = createServer((request, response) => {
    if (request.url === "/image.png" && imageBytes) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(imageBytes);
    } else if (request.url === "/broken.png") {
      response.writeHead(404);
      response.end();
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
const origin = await serve();
const other = await serve();
const browser = await chromium.launch();
const observations = [];

async function compare(page, native, rendered) {
  return page.evaluate(
    async ({ native, rendered }) => {
      const decode = async (data) => {
        const blob = await (
          await fetch(`data:image/png;base64,${data}`)
        ).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          width: canvas.width,
          height: canvas.height,
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const a = await decode(native),
        b = await decode(rendered);
      if (a.width !== b.width || a.height !== b.height)
        return {
          nativeSize: [a.width, a.height],
          renderedSize: [b.width, b.height],
        };
      let different = 0,
        totalDelta = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 4; channel++)
          delta += Math.abs(a.data[i + channel] - b.data[i + channel]);
        if (delta) different++;
        totalDelta += delta;
      }
      const sample = (x, y) => {
        const i = (y * a.width + x) * 4;
        return {
          native: Array.from(a.data.slice(i, i + 4)),
          rendered: Array.from(b.data.slice(i, i + 4)),
        };
      };
      return {
        nativeSize: [a.width, a.height],
        renderedSize: [b.width, b.height],
        differentPixelsPercent:
          Math.round((different / (a.width * a.height)) * 10000) / 100,
        meanChannelDelta: Math.round((totalDelta / a.data.length) * 100) / 100,
        topLeft: sample(0, 0),
        center: sample(Math.floor(a.width / 2), Math.floor(a.height / 2)),
      };
    },
    { native: native.toString("base64"), rendered: rendered.toString("base64") }
  );
}

async function measure(name, options, { dpr = 1, scroll = 0, scenario } = {}) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  try {
    await page.goto(origin.url);
    if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
    const setup = async () =>
      page.evaluate((scenario) => {
        if (scenario === "animations") {
          window.finite = document
            .querySelector("#target")
            .animate([{ background: "#e84848" }, { background: "#00ff00" }], {
              duration: 60000,
              fill: "forwards",
            });
          window.infinite = document
            .querySelector("#cover")
            .animate([{ background: "#164cde" }, { background: "#ffff00" }], {
              duration: 60000,
              iterations: Infinity,
            });
        }
        if (scenario === "caret") {
          const input = document.createElement("input");
          input.id = "form";
          input.value = "Visible caret";
          input.style.cssText =
            "position:absolute;left:80px;top:340px;width:220px;height:50px;caret-color:red!important;";
          document.querySelector("#target").remove();
          document.querySelector("#cover").remove();
          document.body.append(input);
          input.focus();
          input.setSelectionRange(0, 0);
        }
        if (scenario === "shadow") {
          const host = document.createElement("div");
          host.id = "shadow-host";
          host.style.cssText =
            "position:absolute;left:80px;top:340px;width:220px;height:140px;";
          document.querySelector("#target").remove();
          document.querySelector("#cover").remove();
          host.attachShadow({ mode: "open" }).innerHTML =
            '<div id="shadow-target" style="width:220px;height:140px;background:red"></div>';
          document.body.append(host);
        }
      }, scenario);
    const state = async () =>
      page.evaluate(() => ({
        scroll: [scrollX, scrollY],
        targetBackground:
          document.querySelector("#target") &&
          getComputedStyle(document.querySelector("#target")).backgroundColor,
        inputCaret: document
          .querySelector("#form")
          ?.style.getPropertyValue("caret-color"),
        inputCaretPriority: document
          .querySelector("#form")
          ?.style.getPropertyPriority("caret-color"),
        finite: window.finite?.playState,
        infinite: window.infinite?.playState,
        shadowBackground:
          document.querySelector("#shadow-host") &&
          getComputedStyle(
            document.querySelector("#shadow-host").shadowRoot.firstElementChild
          ).backgroundColor,
        temporaryStylePresent: !!window.__pwCleanupScreenshot,
      }));
    if (scenario) await setup();
    const { target, mask, ...nativeOptions } = options;
    if (mask)
      nativeOptions.mask = mask.map((selector) => page.locator(selector));
    const native = target
      ? await page.locator(target).screenshot(nativeOptions)
      : await page.screenshot(nativeOptions);
    const nativeAfter = await state();
    if (scenario) {
      await page.goto(origin.url);
      await setup();
    }
    const result = await page.evaluate(
      (options) => window.capturePrototype(options),
      options
    );
    const { data, ...info } = result;
    const rendered = Buffer.from(data);
    const comparison = await compare(page, native, rendered);
    const ext = options.type ?? "png";
    await writeFile(resolve(output, `${name}.playwright.${ext}`), native);
    await writeFile(resolve(output, `${name}.snapdom.${ext}`), rendered);
    const prototypeAfter = await state();
    observations.push({
      name,
      dpr,
      scroll,
      scenario,
      options,
      ...info,
      comparison,
      nativeAfter,
      prototypeAfter,
    });
    console.log(
      JSON.stringify({ name, ...info, comparison, nativeAfter, prototypeAfter })
    );
  } catch (error) {
    observations.push({ name, error: error.message });
    console.log(JSON.stringify({ name, error: error.message }));
  } finally {
    await context.close();
  }
}

try {
  for (const [name, options] of [
    ["viewport", {}],
    ["fullPage", { fullPage: true }],
    ["clip", { clip: { x: 80, y: 340, width: 220, height: 140 } }],
    ["locator", { target: "#target" }],
    ["jpeg", { type: "jpeg", quality: 80 }],
    ["webp", { type: "webp", quality: 100 }],
    ["transparent", { omitBackground: true }],
    ["mask", { target: "#target", mask: ["#cover"] }],
    [
      "style",
      {
        target: "#target",
        style: "#target { background: #00ff00 !important; }",
      },
    ],
    ["nested-scroller", { target: "#scroller" }],
  ])
    await measure(name, options);
  await measure("device-scale", {}, { dpr: 2 });
  await measure("css-scale", { scale: "css" }, { dpr: 2 });
  await measure("scrolled-viewport", {}, { scroll: 600 });
  await measure("scrolled-fullPage", { fullPage: true }, { scroll: 600 });
  await measure(
    "scrolled-clip",
    { clip: { x: 80, y: 20, width: 220, height: 100 } },
    { scroll: 600 }
  );
  await measure(
    "animations-disabled",
    {
      animations: "disabled",
      clip: { x: 80, y: 340, width: 220, height: 140 },
    },
    { scenario: "animations" }
  );
  await measure(
    "caret-hide",
    { target: "#form", caret: "hide" },
    { scenario: "caret" }
  );
  await measure(
    "caret-initial",
    { target: "#form", caret: "initial" },
    { scenario: "caret" }
  );
  await measure(
    "shadow-style",
    {
      target: "#shadow-host",
      style: "#shadow-target { background: #00ff00 !important; }",
    },
    { scenario: "shadow" }
  );

  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(origin.url);
  imageBytes = await page.locator("#pixels").screenshot();
  const lossless = await page.evaluate(async () => {
    const source = document.querySelector("#pixels");
    const original = source.getContext("2d").getImageData(0, 0, 128, 128).data;
    const result = await snapdom(source, { dpr: 1, cache: "disabled" });
    const measurements = [];
    for (const format of ["png", "webp", "jpeg"]) {
      const blob = await result.toBlob({ format, quality: 1 });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changedChannels = 0;
      for (let i = 0; i < original.length; i++)
        if (original[i] !== actual[i]) changedChannels++;
      measurements.push({
        format,
        width: bitmap.width,
        height: bitmap.height,
        changedChannels,
        totalChannels: original.length,
        bytes: blob.size,
      });
      bitmap.close();
    }
    return measurements;
  });
  observations.push({ name: "lossless-format-measurement", results: lossless });
  console.log(JSON.stringify(observations.at(-1)));

  for (const [name, url] of [
    ["readable-image", `${origin.url}/image.png`],
    ["cross-origin-image", `${other.url}/image.png`],
    ["broken-image", `${origin.url}/broken.png`],
  ]) {
    await page.goto(origin.url);
    await page.evaluate(async (url) => {
      const img = document.createElement("img");
      img.id = "resource-probe";
      Object.assign(img.style, {
        position: "absolute",
        left: "600px",
        top: "340px",
        width: "128px",
        height: "128px",
      });
      const loaded = new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      img.src = url;
      document.body.append(img);
      await loaded;
    }, url);
    const result = await page.evaluate(async () => {
      const img = document.querySelector("#resource-probe");
      const capture = await capturePrototype({ target: "#resource-probe" });
      const { data, ...info } = capture;
      return { imageLoaded: img.naturalWidth > 0, ...info };
    });
    observations.push({ name, ...result });
    console.log(JSON.stringify(observations.at(-1)));
  }
  await page.goto(origin.url);
  const tainted = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.querySelector("#pixels");
    canvas.getContext("2d").drawImage(image, 0, 0);
    let readabilityError;
    try {
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
    } catch (e) {
      readabilityError = e.name;
    }
    const { data, ...capture } = await capturePrototype({ target: "#pixels" });
    return { readabilityError, ...capture };
  }, `${other.url}/image.png`);
  observations.push({ name: "tainted-canvas", ...tainted });
  console.log(JSON.stringify(observations.at(-1)));
  await page.goto(
    pathToFileURL(resolve(root, "src/screenshot.prototype.html")).href
  );
  await page.getByRole("button", { name: "locator", exact: true }).click();
  await page.locator("dialog[open] img").waitFor({ state: "visible" });
  const standalone = await page.locator("#details").textContent();
  observations.push({ name: "standalone-file-preview", status: standalone });
  console.log(JSON.stringify(observations.at(-1)));
  await page.screenshot({ path: resolve(output, "standalone-preview.png") });
  await page.close();
  await writeFile(
    resolve(root, "src/screenshot.prototype.observations.json"),
    JSON.stringify(
      {
        snapdom: "3.2.0",
        playwright: "1.62.1",
        browser: browser.version(),
        note: "Native Playwright compared to direct SnapDOM prototype. Not adapter compatibility evidence.",
        observations,
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await browser.close();
  origin.server.close();
  other.server.close();
}
