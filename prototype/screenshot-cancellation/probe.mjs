// Runnable probe for screenshot issue #255. Diagnostic only: not a contract
// test, not compatibility evidence, and it promotes nothing.
//
//   node prototype/screenshot-cancellation/probe.mjs [scenario ...]
//   CHROMIUM_EXECUTABLE=/path/to/chrome node prototype/screenshot-cancellation/probe.mjs
//
// Serves this directory from two loopback origins, runs each scenario of
// harness.js in a fresh Chromium context and writes observations.json.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { chromium } from "playwright";

const here = import.meta.dirname;
const require = createRequire(import.meta.url);

function png(r, g, b) {
  const size = 20;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const COLORS = { green: [0, 128, 0], red: [255, 0, 0], blue: [0, 0, 255] };
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};
const EXTERNAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="/res/green.png" width="40" height="40"/></svg>`;
const FRAME = `<!doctype html><body style="margin:0;background:rgb(0,128,0)"></body>`;
const BROKEN_FRAME = `<!doctype html><body style="margin:0"><div style="width:40px;height:30px;background:url(/res/missing-frame-bg.png)"></div><video src="/res/stall-frame-video.webm" muted width="10" height="10"></video></body>`;
const font = await readFile(resolve(here, "fixtures/iconfont.woff2"));
let video = Buffer.alloc(0);

// Resource modes: "ok" (default), "404", or "stall" (held until changed).
const modes = new Map();
const held = new Map();

function resource(name) {
  const key = name.replace(/\.[a-z0-9]+$/, "");
  const extension = extname(name);
  if (extension === ".woff2") return font;
  if (extension === ".webm") return video;
  if (extension === ".svg") return Buffer.from(EXTERNAL_SVG);
  return png(...(COLORS[key] ?? [255, 0, 255]));
}

function answer(response, name, mode, headers) {
  if (mode === "404") {
    response.writeHead(404, headers);
    response.end();
    return;
  }
  response.writeHead(200, {
    ...headers,
    "content-type": TYPES[extname(name)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(resource(name));
}

function setMode(key, mode) {
  modes.set(key, mode);
  if (mode === "stall") return;
  for (const { response, name, headers } of held.get(key) ?? [])
    if (!response.destroyed) answer(response, name, mode, headers);
  held.delete(key);
}

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const origin = await serve(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/control") {
    setMode(url.searchParams.get("key"), url.searchParams.get("mode"));
    response.end("ok");
  } else if (url.pathname.startsWith("/res/")) {
    const name = url.pathname.slice(5);
    const key = name.replace(/\.[a-z0-9]+$/, "");
    const mode = modes.get(key) ?? "ok";
    if (mode === "stall") {
      if (!held.has(key)) held.set(key, []);
      held.get(key).push({ response, name, headers: {} });
    } else answer(response, name, mode, {});
  } else if (url.pathname === "/video.webm") {
    answer(response, "video.webm", "ok", {});
  } else if (
    url.pathname === "/frame.html" ||
    url.pathname === "/frame-broken.html"
  ) {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(url.pathname === "/frame.html" ? FRAME : BROKEN_FRAME);
  } else if (url.pathname === "/blank.html") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><body></body>");
  } else {
    const path =
      url.pathname === "/" || url.pathname === "/probe.html"
        ? "probe.html"
        : url.pathname.slice(1);
    try {
      const body = await readFile(resolve(here, path));
      response.writeHead(200, {
        "content-type": TYPES[extname(path)] ?? "text/plain",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  }
});

// The other origin sends no CORS headers.
const cross = await serve((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/frame.html") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(FRAME);
  } else if (url.pathname === "/video.webm")
    answer(response, "video.webm", "ok", {});
  else if (url.pathname.startsWith("/res/"))
    answer(response, url.pathname.slice(5), "ok", {});
  else {
    response.writeHead(404);
    response.end();
  }
});

// CHROMIUM_EXECUTABLE selects a browser other than Playwright's own install.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
});

// A short VP8 clip recorded in the browser, so no binary fixture is needed.
{
  const page = await browser.newPage();
  await page.goto(`${origin.url}/blank.html`);
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = frame++ % 2 ? "rgb(0,128,0)" : "rgb(0,100,0)";
      context.fillRect(0, 0, 64, 48);
    }, 50);
    recorder.start(100);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    recorder.stop();
    await new Promise((resolve) => (recorder.onstop = resolve));
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  video = Buffer.from(base64, "base64");
  await page.close();
}

const names = process.argv.slice(2);
const observations = {
  generatedBy: "prototype/screenshot-cancellation/probe.mjs",
  environment: {
    node: process.version,
    playwright: require("playwright/package.json").version,
    chromium: browser.version(),
    snapdom: "3.2.0",
    snapdomDistSha256: createHash("sha256")
      .update(await readFile(resolve(here, "vendor/snapdom-3.2.0.mjs")))
      .digest("hex"),
    pinnedPlaywrightSource: "26a9e470a7b3c7822084b09fb7f13902c5f37b51",
  },
  scenarios: {},
};

const page = await browser.newPage();
await page.goto(
  `${origin.url}/probe.html?cross=${encodeURIComponent(cross.url)}`
);
const all = await page.evaluate(async () => {
  while (!window.probeReady) await new Promise((r) => setTimeout(r, 20));
  return window.probe.names;
});
await page.close();

for (const name of names.length ? names : all) {
  modes.clear();
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  const console = [];
  tab.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error")
      console.push(`${message.type()}: ${message.text().slice(0, 200)}`);
  });
  tab.on("pageerror", (error) => console.push(`pageerror: ${error.message}`));
  await tab.goto(
    `${origin.url}/probe.html?cross=${encodeURIComponent(cross.url)}`
  );
  await tab.waitForFunction(() => window.probeReady);
  const started = Date.now();
  const outcome = await tab.evaluate(
    (scenario) => window.probe.run(scenario),
    name
  );
  observations.scenarios[name] = {
    ...outcome,
    wallMs: Date.now() - started,
    console,
  };
  process.stdout.write(
    `${name}: ${outcome.ok ? "ran" : "FAILED"} in ${Date.now() - started} ms\n`
  );
  for (const key of held.keys()) setMode(key, "404");
  await context.close();
}

await browser.close();
origin.server.close();
cross.server.close();
const file = resolve(
  here,
  names.length ? "observations.partial.json" : "observations.json"
);
await writeFile(file, JSON.stringify(observations, null, 2) + "\n");
process.stdout.write(`wrote ${file}\n`);
