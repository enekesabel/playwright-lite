// Runs the `hidden-tab` contract rule (tests/contract/hidden-tab.ts) in a
// Chromium tab that is really hidden: another tab sits in front of it, so the
// browser stops its animation frames and clamps its timers.
//
// Playwright cannot drive such a tab: a page it attaches to keeps reporting
// `visible`, and it launches the browser with background throttling off. So
// this script serves the cases with Vite, starts Chromium itself in headless
// mode (the headless shell never hides a tab), and talks to the page over raw
// CDP, `Runtime.evaluate` only.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
// Vitest re-exports its own Vite, which the contract tests already run on.
import { createViteServer as createServer } from "vitest/node";

import { playwrightInjectedPlugin } from "../build/playwrightInjectedPlugin.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const pagePath = "/__hidden-tab";
/** A case that never settles is reported after this long. */
const caseLimitMs = 30_000;

const page = `<!doctype html><meta charset="utf-8"><title>hidden-tab</title>
<script type="module">
  import { hiddenTabCases } from "/tests/contract/hidden-tab.ts";
  window.hiddenTab = {
    names: hiddenTabCases.map(([apiName]) => apiName),
    async run(index) {
      try {
        await hiddenTabCases[index][1]();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) };
      } finally {
        document.body.innerHTML = "";
      }
    },
  };
</script>`;

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  plugins: [
    playwrightInjectedPlugin(),
    {
      name: "hidden-tab-page",
      configureServer(vite) {
        vite.middlewares.use(pagePath, async (request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.end(await vite.transformIndexHtml(pagePath, page));
        });
      },
    },
  ],
  optimizeDeps: { exclude: ["@zumer/snapdom"] },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");

const profile = mkdtempSync(resolve(tmpdir(), "playwright-lite-hidden-tab-"));
const browser = spawn(
  process.env.HIDDEN_TAB_CHROMIUM ?? chromium.executablePath(),
  [
    "--headless",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `${origin}${pagePath}`,
  ],
  { stdio: "ignore" }
);

let failed = 0;
try {
  const port = await until(
    "Chromium's debugging port",
    () =>
      readFileSync(resolve(profile, "DevToolsActivePort"), "utf8").split(
        "\n"
      )[0]
  );
  const endpoint = `http://127.0.0.1:${port}`;
  const [target] = await until("the cases' tab", async () =>
    (await (await fetch(`${endpoint}/json/list`)).json()).filter(
      (entry) => entry.type === "page" && entry.url.endsWith(pagePath)
    )
  );
  const tab = await connect(target.webSocketDebuggerUrl);
  await until("the cases to load", () =>
    tab.evaluate("Boolean(window.hiddenTab)")
  );
  const { webSocketDebuggerUrl } = await (
    await fetch(`${endpoint}/json/version`)
  ).json();
  const controller = await connect(webSocketDebuggerUrl);
  await controller.send("Target.createTarget", { url: "about:blank" });

  // The rule proves nothing unless the browser throttles this tab, which it
  // starts doing a few seconds after hiding it.
  await until(
    "the browser to throttle the hidden tab",
    () =>
      tab.evaluate(`(async () => {
        if (document.visibilityState !== "hidden") return false;
        const started = performance.now();
        for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r));
        return performance.now() - started > 500;
      })()`),
    60_000
  );

  const names = await tab.evaluate("window.hiddenTab.names");
  for (const [index, name] of names.entries()) {
    const started = performance.now();
    const result = await Promise.race([
      tab.evaluate(`window.hiddenTab.run(${index})`),
      delay(caseLimitMs).then(() => ({
        ok: false,
        message: `did not settle within ${caseLimitMs} ms`,
      })),
    ]);
    const elapsed = Math.round(performance.now() - started);
    if (result.ok) console.log(`✓ ${name} (${elapsed} ms)`);
    else {
      failed++;
      console.log(
        `✗ ${name} (${elapsed} ms): ${result.message.split("\n")[0]}`
      );
    }
    // A case that outlived its limit may still be running in the page, so
    // the next one starts in a fresh document, still in the background.
    if (elapsed >= caseLimitMs) {
      await tab.send("Page.reload");
      await until("the cases to reload", () =>
        tab.evaluate("Boolean(window.hiddenTab)")
      );
    }
  }
  console.log(
    failed
      ? `\n${failed} of ${names.length} hidden-tab cases failed.`
      : `\nAll ${names.length} hidden-tab cases passed.`
  );
} finally {
  browser.kill();
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** Retries `read` until it returns a truthy value. */
async function until(what, read, limitMs = 20_000) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    try {
      const value = await read();
      if (value && (!Array.isArray(value) || value.length)) return value;
    } catch {
      // Not there yet.
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${what}.`);
    await delay(200);
  }
}

/** A CDP session over one WebSocket. */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((open, fail) => {
    socket.onopen = open;
    socket.onerror = () => fail(new Error(`Cannot connect to ${url}`));
  });
  let lastId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((answer, fail) => {
      const id = ++lastId;
      pending.set(id, (message) =>
        message.error
          ? fail(new Error(`${method}: ${message.error.message}`))
          : answer(message.result)
      );
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails)
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text
      );
    return result.value;
  };
  return { send, evaluate };
}
