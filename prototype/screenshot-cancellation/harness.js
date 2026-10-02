// In-page probe for screenshot issue #255. probe.mjs loads this page in
// Chromium and calls `probe.run(name)` once per scenario in a fresh context,
// so SnapDOM's module-level caches start empty each time.

import {
  Lifetime,
  Operation,
  cancellationPlugin,
  coordinatorFor,
  createToken,
  prepareForScreenshot,
} from "./coordinator.js";
import {
  cloneScan,
  fontScan,
  imageScan,
  liveSvgImages,
  preScan,
  readable,
  svgScan,
} from "./media.js";

const CROSS = new URLSearchParams(location.search).get("cross");

// ---------------------------------------------------------------- recording

const start = performance.now();
const now = () => Math.round(performance.now() - start);
let timeline = [];
const mark = (label, data = {}) => timeline.push({ t: now(), label, ...data });

let mutations = [];
let recordingMutations = false;
const nodeName = (node) =>
  node.nodeType === Node.TEXT_NODE
    ? "#text"
    : node.nodeType === Node.ELEMENT_NODE
      ? node.localName +
        (node.id ? `#${node.id}` : "") +
        (node.hasAttribute?.("data-snapdom-internal")
          ? "[snapdom-internal]"
          : "")
      : node.nodeName;
new MutationObserver((records) => {
  if (!recordingMutations) return;
  for (const record of records) {
    const entry = {
      t: now(),
      type: record.type,
      target: nodeName(record.target),
    };
    if (record.type === "childList") {
      if (record.addedNodes.length)
        entry.added = [...record.addedNodes].map(nodeName);
      if (record.removedNodes.length)
        entry.removed = [...record.removedNodes].map(nodeName);
    } else if (record.type === "attributes") {
      entry.attribute = record.attributeName;
      entry.oldValue = record.oldValue;
      entry.value = record.target.getAttribute(record.attributeName);
    } else {
      entry.oldValue = record.oldValue?.slice(0, 40);
      entry.value = record.target.data?.slice(0, 40);
    }
    mutations.push(entry);
  }
}).observe(document, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
  attributeOldValue: true,
  characterDataOldValue: true,
});

let unhandled = [];
window.addEventListener("unhandledrejection", (event) => {
  unhandled.push(String(event.reason?.message ?? event.reason));
});

function resetRecording() {
  timeline = [];
  mutations = [];
  unhandled = [];
  recordingMutations = true;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const control = (key, mode) =>
  fetch(`/control?key=${key}&mode=${mode}`).then((r) => r.text());

async function until(predicate, timeout = 15000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("until: timed out");
    await delay(20);
  }
}

/** What differs from a hostState() snapshot, in readable form. */
function hostDiff(before) {
  const then = JSON.parse(before);
  const nowState = JSON.parse(hostState());
  const caret = nowState.caret.filter(
    (entry, i) => JSON.stringify(entry) !== JSON.stringify(then.caret[i])
  );
  return {
    caretChanged: caret,
    snapdomNodes: [...document.querySelectorAll("[data-snapdom-internal]")].map(
      nodeName
    ),
    styleElements:
      document.querySelectorAll("style").length -
      (then.html.match(/<style[ >]/g) ?? []).length,
    styleAttributes: [...document.querySelectorAll("[style]")]
      .filter((e) => !then.html.includes(`style="${e.getAttribute("style")}"`))
      .map((e) => [nodeName(e), e.getAttribute("style")]),
  };
}

/** Host state a capture must leave exactly as it found it. */
function hostState() {
  const caret = [
    ...document.querySelectorAll("input,textarea,[contenteditable]"),
  ].map((element) => [
    element.id,
    element.style.getPropertyValue("caret-color"),
    element.style.getPropertyPriority("caret-color"),
  ]);
  return JSON.stringify({ html: document.documentElement.outerHTML, caret });
}

// ------------------------------------------------------------------ renderer

let snapdomModule;
/** SnapDOM loaded on first capture and reused, as #252 requires. */
const loadSnapdom = () =>
  (snapdomModule ??= import("./vendor/snapdom-3.2.0.mjs"));

async function decode(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    width: canvas.width,
    height: canvas.height,
    at(x, y) {
      const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

function checksum(image) {
  let hash = 2166136261;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      for (const channel of image.at(x, y))
        hash = Math.imul(hash ^ channel, 16777619) >>> 0;
  return hash.toString(16);
}

class MiniPage {
  constructor(name) {
    this.name = name;
    this.lifetime = new Lifetime();
  }
  close() {
    mark("page.close", { page: this.name });
    this.lifetime.close();
  }
  screenshot(target, options = {}) {
    return screenshot(this, target, options);
  }
}

/**
 * The capture operation this investigation recommends. Options beyond
 * Playwright's (`cooperative`, `coordinated`, `restoreAt`, `detachedStyle`,
 * `media`, `snapdom`) exist only to run the probe's comparisons.
 */
async function screenshot(page, target, options = {}) {
  const label = options.label ?? page.name;
  const record = (stage, data) => mark(stage, { capture: label, ...data });
  const {
    timeout = 30000,
    signal,
    style = "",
    caret = "hide",
    cooperative = true,
    coordinated = true,
    restoreAt = "afterRender",
    detachedStyle = "",
    media = "reject",
  } = options;
  const operation = new Operation(page.lifetime, timeout, signal);
  const coordinator = coordinatorFor(window);
  const result = { label, findings: [] };
  let lease;
  let restore;
  let token;
  let renderer;
  const restoreOnce = (stage) => {
    if (restore?.()) record("restored", { at: stage });
  };
  try {
    if (coordinated) {
      record("lease.wait");
      lease = await coordinator.acquire(operation.signal, label);
      record("lease.acquired", { lease: lease.id });
    }
    operation.signal.throwIfAborted();
    restore = prepareForScreenshot(style, caret !== "initial");
    record("prepared");
    await operation.race(document.fonts.ready);
    record("fonts.ready");
    if (media !== "off") {
      const findings = preScan(target);
      result.findings.push(
        ...findings.map((finding) => ({ at: "preScan", ...finding }))
      );
      if (media === "reject" && findings.length)
        throw new Error(`unreadable media: ${JSON.stringify(findings)}`);
    }
    const { snapdom } = await operation.race(loadSnapdom());
    token = createToken();
    const plugin = cancellationPlugin(
      cooperative ? token : createToken(),
      target,
      (stage) => record(`renderer.${stage}`),
      {
        afterClone(context, outer) {
          if (outer && cooperative === false) {
            token.cloneSettled = true;
            token.resolveClone();
          }
          if (!outer) {
            if (media !== "off" && !token.canceled)
              result.findings.push(
                ...cloneScan(context).findings.map((f) => ({
                  at: "afterClone (nested)",
                  ...f,
                }))
              );
            return;
          }
          if (detachedStyle) {
            const node = document.createElement("style");
            node.textContent = detachedStyle;
            context.clone.prepend(node);
          }
          if (media !== "off" && !token.canceled) {
            const scan = cloneScan(context);
            result.replaced = scan.replaced;
            result.findings.push(
              ...scan.findings.map((f) => ({ at: "afterClone", ...f }))
            );
          }
          if (restoreAt === "afterClone" && !token.canceled)
            restoreOnce("afterClone");
        },
        beforeRender(context, outer) {
          if (outer && restoreAt === "beforeRender" && !token.canceled)
            restoreOnce("beforeRender");
        },
        afterRender(context, outer) {
          if (media !== "off" && !token.canceled) {
            const at = outer ? "afterRender" : "afterRender (nested)";
            const scans = [
              ...svgScan(context.svgString ?? ""),
              ...fontScan(context),
              ...imageScan(context),
            ];
            result.findings.push(...scans.map((f) => ({ at, ...f })));
            if (outer)
              result.fontFaces = (
                context.svgString?.match(/@font-face/g) ?? []
              ).length;
          }
          // Encoding below reads only the serialized SVG.
          if (outer && restoreAt === "afterRender" && !token.canceled)
            restoreOnce("afterRender");
        },
      }
    );
    renderer = (async () => {
      const capture = await snapdom(target, {
        plugins: [plugin],
        burst: false,
        ...options.snapdom,
      });
      const blob = await capture.toBlob({ format: options.type ?? "png" });
      return { blob, warnings: capture.warnings };
    })();
    // A renderer that fails inside the clone stage never reaches afterClone.
    renderer.then(token.resolveClone, token.resolveClone);
    renderer.then(
      (value) =>
        record("renderer.settled", {
          outcome: "value",
          warnings: value.warnings.map((w) => w.code),
        }),
      (error) =>
        record("renderer.settled", {
          outcome: "error",
          error: error.name + ": " + error.message,
        })
    );
    if (coordinated) coordinator.track(renderer);
    const { blob, warnings } = await operation.race(renderer);
    result.warnings = warnings.map((warning) => warning.code);
    if (
      media === "reject" &&
      (result.warnings.includes("image-fallback") || result.findings.length)
    )
      throw new Error(
        `capture degraded: ${JSON.stringify({ warnings: result.warnings, findings: result.findings })}`
      );
    result.bytes = new Uint8Array(await operation.race(blob.arrayBuffer()));
    record("resolved");
    return result;
  } catch (error) {
    const reason =
      error?.name === "TargetClosedError" ? error.message : error?.message;
    const wrapped = new Error(
      `${target === document.documentElement ? "page" : "locator"}.screenshot: ${reason}`
    );
    wrapped.name = error?.name ?? "Error";
    wrapped.findings = result.findings;
    wrapped.warnings = result.warnings;
    record("rejected", { error: wrapped.message.slice(0, 160) });
    throw wrapped;
  } finally {
    operation.dispose();
    // Success restores at afterRender; a rejection restores now. A canceled
    // renderer stops at its next hook, so it never reads the restored state
    // into anything that is delivered.
    if (token) token.canceled = true;
    restoreOnce("operation end");
    if (lease) {
      if (renderer && !token.cloneSettled) {
        // SnapDOM's own live mutations are undone only when its clone stage
        // ends, so the next capture waits for that, not for this caller.
        record("lease.held-for-clone");
        token.cloneDone.then(() => {
          record("lease.released", { lease: lease.id, deferred: true });
          coordinator.release(lease);
        });
      } else {
        record("lease.released", { lease: lease.id });
        coordinator.release(lease);
      }
    }
  }
}

async function attempt(promise) {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      name: error.name,
      findings: error.findings,
      warnings: error.warnings,
    };
  }
}

function interrupt(kind, page, ms) {
  if (kind === "timeout") return { timeout: ms };
  if (kind === "signal") {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("aborted by caller")), ms);
    return { signal: controller.signal };
  }
  setTimeout(() => page.close(), ms);
  return {};
}

function after(t) {
  return {
    mutations: mutations.filter((m) => m.t > t),
    timeline: timeline.filter((e) => e.t > t),
  };
}

// ---------------------------------------------------------------- scenarios

const scenarios = {};

/** Criterion 1, stall source A: document.fonts.ready (pinned "should wait for fonts to load"). */
scenarios.stallFonts = async () => {
  await control("font", "stall");
  document.body.innerHTML = `
    <style>
      @font-face { font-family: pwtest-iconfont; src: url(/res/font.woff2) format("woff2"); font-display: swap; }
      #glyphs { font: 40px pwtest-iconfont; }
    </style>
    <div id="card" style="width:120px;height:60px;background:#fff">
      <span id="glyphs">+-</span>
      <input id="caret-a" style="caret-color: red !important; width: 20px">
      <input id="caret-b" style="width: 20px">
    </div>`;
  await until(() => document.fonts.status === "loading");
  const card = document.querySelector("#card");
  const before = hostState();
  resetRecording();
  const runs = {};
  for (const kind of ["timeout", "signal", "close"]) {
    const page = new MiniPage(`fonts-${kind}`);
    const t = now();
    const outcome = await attempt(
      page.screenshot(card, {
        label: page.name,
        style: "#card { outline: 3px solid red }",
        ...interrupt(kind, page, 300),
      })
    );
    runs[kind] = {
      rejectedAfterMs: now() - t,
      outcome,
      rendererStarted: timeline.some(
        (e) => e.capture === page.name && e.label.startsWith("renderer.")
      ),
      hostRestored: hostState() === before,
    };
  }
  const other = new MiniPage("fonts-other-page");
  await control("font", "ok");
  await document.fonts.ready;
  const next = await attempt(
    other.screenshot(card, { label: "after-font-served", media: "report" })
  );
  return {
    runs,
    fontStatusAfterServe: document.fonts.status,
    nextCapture: next.ok
      ? {
          ok: true,
          fontFacesEmbedded: next.value.fontFaces,
          warnings: next.value.warnings,
          findings: next.value.findings,
        }
      : next,
    hostRestored: hostState() === before,
    unhandled,
  };
};

/** Criterion 1, stall source B: an <img> fetch, bounded by snapFetch's 3000 ms. */
scenarios.stallImage = async () => {
  const runs = {};
  for (const cooperative of [true, false]) {
    for (const kind of ["timeout", "signal", "close"]) {
      const key = `slow-${kind}-${cooperative ? "coop" : "free"}`;
      await control(key, "stall");
      document.body.innerHTML = `
        <div id="card" style="width:120px;height:60px;background:#0a0">
          <img src="/res/${key}.png" width="40" height="40">
        </div>`;
      const card = document.querySelector("#card");
      await delay(50);
      const before = hostState();
      resetRecording();
      const page = new MiniPage(key);
      const t0 = now();
      const outcome = await attempt(
        page.screenshot(card, {
          label: key,
          cooperative,
          ...interrupt(kind, page, 300),
        })
      );
      const rejectedAt = now();
      await until(
        () =>
          timeline.some(
            (e) => e.capture === key && e.label === "renderer.settled"
          ),
        10000
      );
      await delay(300);
      const settled = timeline.find(
        (e) => e.capture === key && e.label === "renderer.settled"
      );
      runs[key] = {
        rejectedAfterMs: rejectedAt - t0,
        error: outcome.error,
        stages: timeline
          .filter((e) => e.capture === key)
          .map((e) => `${e.t - t0}ms ${e.label}`),
        rendererSettledAfterMs: settled.t - t0,
        rendererOutcome: settled.outcome,
        lateWarnings: settled.warnings,
        mutationsAfterRejection: after(rejectedAt).mutations,
        snapdomNodesLeft: [
          ...document.querySelectorAll("[data-snapdom-internal]"),
        ].map(nodeName),
        hostRestored: hostState() === before,
        unhandled: [...unhandled],
      };
      await control(key, "ok");
    }
  }
  return runs;
};

/**
 * Criterion 1, stall source C, and criterion 2's "subsequent capture while
 * the old renderer work remains pending": a fixed background's
 * freezeFixedBackground awaits img.decode() with no timeout.
 */
scenarios.stallFixedBackground = async () => {
  await control("hang", "stall");
  document.body.innerHTML = `
    <div id="fixed" style="width:100px;height:50px;background:url(/res/hang.png) fixed"></div>
    <div id="other" style="width:80px;height:40px;background:rgb(0,0,255)"></div>`;
  await delay(50);
  const before = hostState();
  resetRecording();
  const a = new MiniPage("A");
  const b = new MiniPage("B");
  const t0 = now();
  const first = await attempt(
    a.screenshot(document.querySelector("#fixed"), {
      label: "A",
      timeout: 1000,
    })
  );
  const rejectedAt = now();
  await delay(7000);
  const pendingAt8s = !timeline.some(
    (e) => e.capture === "A" && e.label === "renderer.settled"
  );
  const aStages = timeline
    .filter((e) => e.capture === "A")
    .map((e) => `${e.t - t0}ms ${e.label}`);
  const tB = now();
  const second = await attempt(
    b.screenshot(document.querySelector("#other"), {
      label: "B",
      timeout: 2000,
    })
  );
  let pixel;
  if (second.ok) {
    const image = await decode(second.value.bytes);
    pixel = {
      size: [image.width, image.height],
      center: image.at(image.width / 2, image.height / 2),
    };
  }
  const bDoneAt = now();
  const stillPendingAfterB = !timeline.some(
    (e) => e.capture === "A" && e.label === "renderer.settled"
  );
  await control("hang", "ok");
  await until(
    () =>
      timeline.some((e) => e.capture === "A" && e.label === "renderer.settled"),
    10000
  ).catch(() => {});
  await delay(300);
  return {
    first: { rejectedAfterMs: rejectedAt - t0, error: first.error },
    aStagesBeforeRelease: aStages,
    rendererPendingSevenSecondsAfterTimeout: pendingAt8s,
    second: second.ok
      ? {
          ok: true,
          waitedForLeaseMs:
            (timeline.find(
              (e) => e.capture === "B" && e.label === "lease.acquired"
            )?.t ?? 0) - tB,
          tookMs: bDoneAt - tB,
          ...pixel,
        }
      : second,
    aStillPendingAfterB: stillPendingAfterB,
    aAfterRelease: timeline
      .filter((e) => e.capture === "A" && e.t > bDoneAt)
      .map((e) => `${e.label}${e.error ? " " + e.error : ""}`),
    mutationsAfterB: after(bDoneAt).mutations,
    hostRestored: hostState() === before,
    unhandled,
  };
};

const TWO_PAGES_FIXTURE = (key) => `
  <div id="a" style="width:100px;height:50px;background:#fff"><img src="/res/${key}.png" width="30" height="30"></div>
  <div id="b" style="width:100px;height:50px;background:#fff"></div>
  <input id="caret-a" style="caret-color: rgb(1, 2, 3) !important">
  <input id="caret-b" style="caret-color: blue">
  <textarea id="caret-c"></textarea>
  <div id="caret-d" contenteditable="true">x</div>`;

/** Criterion 2: overlapping captures from two Page instances in one document. */
scenarios.twoPages = async () => {
  const runs = {};
  for (const kind of ["timeout", "signal", "close", "uncoordinated"]) {
    const coordinated = kind !== "uncoordinated";
    const key = `two-${kind}`;
    await control(key, "stall");
    document.body.innerHTML = TWO_PAGES_FIXTURE(key);
    await delay(50);
    const before = hostState();
    resetRecording();
    const a = new MiniPage(`A-${kind}`);
    const b = new MiniPage(`B-${kind}`);
    const t0 = now();
    // A's rule outranks B's, so B shows red if A's preparation is still applied.
    const pa = attempt(
      a.screenshot(document.querySelector("#a"), {
        label: a.name,
        coordinated,
        style: "html body #b { background: rgb(255, 0, 0) !important }",
        ...interrupt(coordinated ? kind : "timeout", a, 500),
      })
    );
    await delay(100);
    const pb = attempt(
      b.screenshot(document.querySelector("#b"), {
        label: b.name,
        coordinated,
        style: "#b { background: rgb(0, 128, 0) !important }",
        timeout: 5000,
      })
    );
    const [ra, rb] = await Promise.all([pa, pb]);
    const aRejectedAt = timeline.find(
      (e) => e.capture === a.name && e.label === "rejected"
    )?.t;
    let bPixel;
    if (rb.ok) {
      const image = await decode(rb.value.bytes);
      bPixel = image.at(50, 25);
    }
    const hostAfterBoth = hostState() === before;
    const leftWhilePending = [
      ...document.querySelectorAll("[data-snapdom-internal]"),
    ].map(nodeName);
    await until(
      () =>
        timeline.some(
          (e) => e.capture === a.name && e.label === "renderer.settled"
        ),
      10000
    );
    await delay(300);
    const late = after(aRejectedAt);
    const bResolvedAt =
      timeline.find((e) => e.capture === b.name && e.label === "resolved")?.t ??
      aRejectedAt;
    runs[kind] = {
      a: { error: ra.error, rejectedAfterMs: aRejectedAt - t0 },
      b: rb.ok
        ? {
            ok: true,
            pixel: bPixel,
            leaseAcquiredAfterMs:
              (timeline.find(
                (e) => e.capture === b.name && e.label === "lease.acquired"
              )?.t ?? NaN) - t0,
          }
        : rb,
      aRenderer: timeline
        .filter((e) => e.capture === a.name && e.t > aRejectedAt)
        .map((e) => `${e.t - t0}ms ${e.label}${e.error ? " " + e.error : ""}`),
      hostRestoredWhenBothSettled: hostAfterBoth,
      hostRestoredAfterLateWork: hostState() === before,
      hostDiffAfterLateWork: hostDiff(before),
      mutationsAfterARejected: late.mutations.length,
      mutationsAfterBResolved: after(bResolvedAt).mutations,
      snapdomNodesWhileARendererPending: leftWhilePending,
      unhandled: [...unhandled],
    };
    await control(key, "ok");
  }
  return runs;
};

/**
 * The pinned preparation keeps one cleanup per window
 * (`window.__pwCleanupScreenshot`). Two overlapping preparations in one
 * document lose the first cleanup.
 */
scenarios.pinnedCleanupSlot = async () => {
  document.body.innerHTML = `<div id="x"></div>`;
  const before = hostState();
  // Pinned server/screenshotter.ts inPagePrepareForScreenshots, style part, verbatim apart from types.
  function inPagePrepareForScreenshots(screenshotStyle) {
    const cleanupCallbacks = [];
    const styleTag = document.createElement("style");
    styleTag.textContent = screenshotStyle;
    document.documentElement.append(styleTag);
    cleanupCallbacks.push(() => {
      styleTag.remove();
    });
    window.__pwCleanupScreenshot = () => {
      for (const cleanupCallback of cleanupCallbacks) cleanupCallback();
      delete window.__pwCleanupScreenshot;
    };
  }
  inPagePrepareForScreenshots("#x { color: red }"); // Page 1
  inPagePrepareForScreenshots("#x { color: green }"); // Page 2 overlaps
  window.__pwCleanupScreenshot && window.__pwCleanupScreenshot(); // Page 2 restores
  window.__pwCleanupScreenshot && window.__pwCleanupScreenshot(); // Page 1 restores: slot already empty
  return {
    leftoverStyleTags: [...document.querySelectorAll("html > style")].map(
      (s) => s.textContent
    ),
    hostRestored: hostState() === before,
  };
};

const CLAMP_TEXT =
  "The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly and the job requires extra pluck.";
const CLAMP_FIXTURE = (key) => `
  <style>#clamp::before { content: url(/res/${key}.png); }</style>
  <p id="clamp" style="width:140px;font:14px/18px sans-serif;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${CLAMP_TEXT}</p>`;

/** SnapDOM's live line-clamp rewrite (modules/lineClamp.js) has no reentrancy guard. */
scenarios.lineClamp = async () => {
  const { snapdom } = await loadSnapdom();
  const out = {};

  // Uncoordinated: two raw SnapDOM captures overlap during the clone stage.
  await control("pseudo-raw", "stall");
  document.body.innerHTML = CLAMP_FIXTURE("pseudo-raw");
  await delay(50);
  let clamp = document.querySelector("#clamp");
  resetRecording();
  const first = snapdom(clamp, { burst: false });
  await delay(200);
  const textDuringCapture = clamp.textContent;
  const second = snapdom(clamp, { burst: false });
  await Promise.allSettled([first, second]);
  await control("pseudo-raw", "ok");
  out.uncoordinated = {
    hostTextDuringCapture: textDuringCapture,
    hostTextAfterBoth: clamp.textContent,
    textRestored: clamp.textContent === CLAMP_TEXT,
  };

  // The page edits the clamped text node while a capture's clone stage runs.
  await control("pseudo-edit", "stall");
  document.body.innerHTML = CLAMP_FIXTURE("pseudo-edit");
  await delay(50);
  clamp = document.querySelector("#clamp");
  const editStart = now();
  let editSettledAt;
  const editing = snapdom(clamp, { burst: false }).finally(
    () => (editSettledAt = now())
  );
  await delay(200);
  const textBeforeEdit = clamp.textContent;
  clamp.firstChild.data = "Edited by the page";
  const editAt = now();
  await Promise.allSettled([editing]);
  await control("pseudo-edit", "ok");
  out.pageEditDuringCloneStage = {
    hostTextBeforeEdit: textBeforeEdit,
    editAfterMs: editAt - editStart,
    captureSettledAfterMs: editSettledAt - editStart,
    hostTextAfterCapture: clamp.textContent,
    pageEditLost: clamp.textContent !== "Edited by the page",
  };

  // Coordinated: A is canceled inside its clone stage; B waits for it.
  await control("pseudo-coord", "stall");
  document.body.innerHTML = CLAMP_FIXTURE("pseudo-coord");
  await delay(50);
  clamp = document.querySelector("#clamp");
  resetRecording();
  const a = new MiniPage("A");
  const b = new MiniPage("B");
  const t0 = now();
  const pa = attempt(
    a.screenshot(clamp, { label: "A", timeout: 300, media: "off" })
  );
  await delay(100);
  const pb = attempt(
    b.screenshot(clamp, { label: "B", timeout: 10000, media: "off" })
  );
  const [ra, rb] = await Promise.all([pa, pb]);
  await until(
    () =>
      timeline.some((e) => e.capture === "A" && e.label === "renderer.settled"),
    10000
  );
  await control("pseudo-coord", "ok");
  out.coordinated = {
    a: { error: ra.error },
    b: rb.ok ? { ok: true } : rb,
    stages: timeline
      .filter((e) => e.capture)
      .map((e) => `${e.t - t0}ms ${e.capture} ${e.label}`),
    hostTextAfterBoth: clamp.textContent,
    textRestored: clamp.textContent === CLAMP_TEXT,
    unhandled,
  };
  return out;
};

/** Criterion 3: when may live preparation be restored? */
scenarios.safeBoundary = async () => {
  document.body.innerHTML = `
    <div id="box" style="width:100px;height:50px;background:url(/res/blue.png)"></div>`;
  await new Promise((resolve) => {
    const image = new Image();
    image.onload = image.onerror = resolve;
    image.src = "/res/blue.png";
  });
  const box = document.querySelector("#box");
  const style =
    "#box { background: rgb(0, 128, 0) !important; width: 160px !important; }";
  const page = new MiniPage("boundary");
  const variants = {
    restoreAfterRender: { style, restoreAt: "afterRender" },
    restoreBeforeRender: { style, restoreAt: "beforeRender" },
    restoreAfterClone: { style, restoreAt: "afterClone" },
    detachedCloneStyle: { detachedStyle: style },
  };
  const out = {};
  for (const [name, options] of Object.entries(variants)) {
    const result = await attempt(
      page.screenshot(box, { label: name, media: "off", ...options })
    );
    if (!result.ok) {
      out[name] = result;
      continue;
    }
    const image = await decode(result.value.bytes);
    out[name] = {
      size: [image.width, image.height],
      left: image.at(10, 25),
      right: image.at(Math.max(0, image.width - 10), 25),
    };
  }
  return out;
};

/** Cross-capture state a canceled or failed capture leaves for the next one. */
scenarios.contamination = async () => {
  const out = {};

  // 1. snapFetch's error cache (8 s TTL) after a canceled capture's fetch timed out.
  await control("flaky", "stall");
  document.body.innerHTML = `<div id="card" style="width:60px;height:60px"><img src="/res/flaky.png" width="40" height="40"></div>`;
  const card = document.querySelector("#card");
  resetRecording();
  const page = new MiniPage("contamination");
  const canceled = await attempt(
    page.screenshot(card, { label: "canceled", timeout: 300 })
  );
  await until(
    () =>
      timeline.some(
        (e) => e.capture === "canceled" && e.label === "renderer.settled"
      ),
    10000
  );
  await control("flaky", "ok");
  const servedAt = now();
  const direct = await fetch("/res/flaky.png").then((r) => r.status);
  const next = await attempt(page.screenshot(card, { label: "next" }));
  const nextUncached = await attempt(
    page.screenshot(card, {
      label: "next-cache-disabled",
      snapdom: { cache: "disabled" },
    })
  );
  await delay(Math.max(0, 8200 - (now() - servedAt)));
  const later = await attempt(page.screenshot(card, { label: "after-ttl" }));
  out.errorCache = {
    canceled: canceled.error,
    resourceStatusNow: direct,
    nextCapture: next.ok ? "ok" : next.error.slice(0, 140),
    nextWithCacheDisabled: nextUncached.ok
      ? "ok"
      : nextUncached.error.slice(0, 140),
    afterErrorTtl: later.ok ? "ok" : later.error.slice(0, 140),
  };

  // 2. cache.background remembers a failed background permanently.
  await control("flakybg", "404");
  document.body.innerHTML = `<div id="bg" style="width:60px;height:30px;background:url(/res/flakybg.png)"></div>`;
  const bg = document.querySelector("#bg");
  const failed = await attempt(page.screenshot(bg, { label: "bg-404" }));
  await control("flakybg", "ok");
  await delay(8200);
  const withCache = await attempt(page.screenshot(bg, { label: "bg-served" }));
  const withInvalidate = await attempt(
    page.screenshot(bg, {
      label: "bg-served-invalidate",
      snapdom: { invalidate: true },
    })
  );
  const withoutCache = await attempt(
    page.screenshot(bg, {
      label: "bg-served-cache-disabled",
      snapdom: { cache: "disabled" },
    })
  );
  const pixel = async (attempted) => {
    if (!attempted.ok) return attempted.error.slice(0, 160);
    const image = await decode(attempted.value.bytes);
    return { center: image.at(30, 15), findings: attempted.value.findings };
  };
  out.backgroundCache = {
    whileMissing: await pixel(failed),
    servedLater: await pixel(withCache),
    servedLaterInvalidate: await pixel(withInvalidate),
    servedLaterCacheDisabled: await pixel(withoutCache),
  };

  // 3. Memoization and style caches after a CSSOM-only change.
  const { snapdom } = await loadSnapdom();
  document.body.innerHTML = `<style id="sheet">#memo { background: rgb(255, 0, 0); }</style><div id="memo" style="width:40px;height:20px"></div>`;
  const memo = document.querySelector("#memo");
  const raw = async (options) => {
    const capture = await snapdom(memo, options);
    const image = await decode(
      new Uint8Array(
        await (await capture.toBlob({ format: "png" })).arrayBuffer()
      )
    );
    return image.at(20, 10);
  };
  const first = await raw({});
  document
    .querySelector("#sheet")
    .sheet.insertRule("#memo { background: rgb(0, 0, 255) !important; }", 1);
  out.cssomChange = {
    beforeChange: first,
    defaultOptions: await raw({}),
    burstFalse: await raw({ burst: false }),
    operation: await pixel(
      await attempt(page.screenshot(memo, { label: "cssom" }))
    ),
    cacheDisabled: await raw({ burst: false, cache: "disabled" }),
    invalidate: await raw({ invalidate: true }),
  };
  document
    .querySelector("#sheet")
    .sheet.insertRule("#memo { background: rgb(0, 128, 0) !important; }", 2);
  out.cssomChangeAgain = {
    cacheDisabled: await raw({ burst: false, cache: "disabled" }),
    operationWithCacheDisabled: await pixel(
      await attempt(
        page.screenshot(memo, {
          label: "cssom-2",
          snapdom: { cache: "disabled" },
        })
      )
    ),
    operationWithInvalidateAndCacheDisabled: await pixel(
      await attempt(
        page.screenshot(memo, {
          label: "cssom-3",
          snapdom: { invalidate: true, cache: "disabled" },
        })
      )
    ),
  };
  return out;
};

/** Criterion 4: known media failures and where each is detectable. */
scenarios.media = async () => {
  const cross = CROSS;
  await control("missing-bg", "404");
  await control("missing-svg", "404");
  await control("missing-img", "404");
  await control("missing-frame-bg", "404");
  await control("stall-video", "stall");
  document.body.innerHTML = `
    <div id="canvas-ok" class="m"><canvas width="40" height="40"></canvas></div>
    <div id="canvas-tainted" class="m"><canvas width="40" height="40"></canvas></div>
    <div id="canvas-untouched" class="m"><canvas width="40" height="40"></canvas></div>
    <div id="bg-failed" class="m" style="background:url(/res/missing-bg.png)"></div>
    <div id="svg-image-failed" class="m"><svg width="40" height="40"><image href="/res/missing-svg.png" width="40" height="40"/></svg></div>
    <div id="svg-image-ok" class="m"><svg width="40" height="40"><image href="/res/green.png" width="40" height="40"/></svg></div>
    <div id="svg-file-external" class="m"><img src="/res/external.svg" width="40" height="40"></div>
    <div id="img-failed" class="m"><img src="/res/missing-img.png" width="40" height="40"></div>
    <div id="img-cross-no-cors" class="m"><img src="${cross}/res/green.png" width="40" height="40"></div>
    <div id="video-cross" class="m"><video src="${cross}/video.webm" muted width="40" height="40"></video></div>
    <div id="video-cross-poster" class="m"><video src="${cross}/video.webm" poster="/res/green.png" muted width="40" height="40"></video></div>
    <div id="video-same" class="m"><video src="/video.webm" muted width="40" height="40"></video></div>
    <div id="video-stalled" class="m"><video src="/res/stall-video.webm" muted width="40" height="40"></video></div>
    <div id="iframe-cross" class="m"><iframe src="${cross}/frame.html" width="40" height="40" style="border:0"></iframe></div>
    <div id="iframe-same" class="m"><iframe src="/frame.html" width="40" height="40" style="border:0"></iframe></div>
    <div id="iframe-same-failed-bg" class="m"><iframe src="/frame-broken.html" width="40" height="40" style="border:0"></iframe></div>
    <div id="font-icon-named" class="m" style="font: 30px pwtest-iconfont">+-</div>
    <div id="font-plain-named" class="m" style="font: 30px pwtest-plain">+-</div>
    <style>
      .m { width: 40px; height: 40px; margin: 4px; }
      @font-face { font-family: pwtest-iconfont; src: url(/fixtures/iconfont.woff2) format("woff2"); }
      @font-face { font-family: pwtest-plain; src: url(/fixtures/iconfont.woff2) format("woff2"); }
    </style>`;
  await document.fonts.load("30px pwtest-iconfont");
  await document.fonts.load("30px pwtest-plain");
  const draw = (id, source) => {
    const canvas = document.querySelector(`#${id} canvas`);
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(0, 128, 0)";
    context.fillRect(0, 0, 40, 40);
    if (source) context.drawImage(source, 0, 0, 20, 20);
    return { canvas, context };
  };
  const crossImage = new Image();
  crossImage.src = `${cross}/res/red.png`;
  await crossImage.decode();
  draw("canvas-ok");
  draw("canvas-tainted", crossImage);
  for (const video of document.querySelectorAll(
    "#video-cross video, #video-cross-poster video, #video-same video"
  )) {
    await until(() => video.readyState >= 2);
    await video.play();
    await delay(150);
    video.pause();
  }
  for (const frame of document.querySelectorAll("iframe"))
    await until(() => frame.dataset.loaded || frame.contentWindow, 5000);
  await delay(500);

  // Pre-scan must leave canvas pixels and context state alone.
  const ok = document.querySelector("#canvas-ok canvas");
  const okContext = ok.getContext("2d");
  const pixelBefore = [...okContext.getImageData(0, 0, 40, 40).data].join();
  okContext.fillStyle = "rgb(9, 9, 9)";
  okContext.globalAlpha = 0.5;
  const untouched = document.querySelector("#canvas-untouched canvas");
  const preScanOfAll = preScan(document.body);
  const preservation = {
    sameContext: ok.getContext("2d") === okContext,
    samePixels:
      [...okContext.getImageData(0, 0, 40, 40).data].join() === pixelBefore,
    fillStyleKept: okContext.fillStyle === "#090909",
    globalAlphaKept: okContext.globalAlpha === 0.5,
    untouchedCanvasStillAcceptsWebgl:
      untouched.getContext("webgl") !== null ||
      untouched.getContext("webgl2") !== null,
    tainted: readable(document.querySelector("#canvas-tainted canvas")),
  };

  const page = new MiniPage("media");
  const results = {};
  for (const item of document.querySelectorAll(".m")) {
    resetRecording();
    const outcome = await attempt(
      page.screenshot(item, { label: item.id, media: "report" })
    );
    const entry = {};
    if (outcome.ok) {
      const image = await decode(outcome.value.bytes);
      entry.center = image.at(image.width / 2, image.height / 2);
      entry.checksum = checksum(image);
      entry.warnings = outcome.value.warnings;
      entry.findings = outcome.value.findings;
      entry.replaced = outcome.value.replaced;
    } else {
      entry.error = outcome.error.slice(0, 200);
    }
    results[item.id] = entry;
  }
  // placeholders:false turns the reported image fallback into a silent spacer.
  const spacer = await attempt(
    page.screenshot(document.querySelector("#img-failed"), {
      label: "img-failed-no-placeholder",
      media: "report",
      snapdom: { placeholders: false },
    })
  );
  results["img-failed (placeholders: false)"] = spacer.ok
    ? { warnings: spacer.value.warnings, findings: spacer.value.findings }
    : { error: spacer.error };
  return {
    preScan: preScanOfAll,
    preScanPreservesCanvas: preservation,
    liveSvgImageHrefs: liveSvgImages(document.body),
    captures: results,
  };
};

/** Exact restoration of the pinned caret preparation. */
scenarios.caretRestoration = async () => {
  const out = {};
  for (const exactAttributes of [false, true]) {
    document.body.innerHTML = `
      <input id="authored" style="caret-color: rgb(1, 2, 3) !important;width:20px">
      <input id="other-inline" style="width: 20px">
      <textarea id="no-attribute"></textarea>
      <div id="editable" contenteditable="true">x</div>`;
    const before = [
      ...document.querySelectorAll("input,textarea,[contenteditable]"),
    ].map((e) => [e.id, e.getAttribute("style")]);
    const restore = prepareForScreenshot("", true, { exactAttributes });
    const during = [
      ...document.querySelectorAll("input,textarea,[contenteditable]"),
    ].map((e) => [e.id, e.getAttribute("style")]);
    restore();
    const after = [
      ...document.querySelectorAll("input,textarea,[contenteditable]"),
    ].map((e) => [e.id, e.getAttribute("style")]);
    out[exactAttributes ? "attributeText" : "pinned"] = {
      before,
      during,
      after,
      identical: JSON.stringify(before) === JSON.stringify(after),
    };
  }
  return out;
};

/** SnapDOM's own document mutations during an ordinary successful capture. */
scenarios.hostMutations = async () => {
  const { snapdom } = await loadSnapdom();
  document.body.innerHTML = `<div id="card" style="width:80px;height:40px;background:rgb(0,0,255)"><p>text</p></div>`;
  const card = document.querySelector("#card");
  resetRecording();
  const capture = await snapdom(card, { burst: false });
  await capture.toBlob({ format: "png" });
  await delay(100);
  const raw = {
    mutations: [...mutations],
    leftAfterCapture: [
      ...document.querySelectorAll("[data-snapdom-internal]"),
    ].map(nodeName),
  };
  resetRecording();
  const page = new MiniPage("host");
  await page.screenshot(card, { label: "operation" });
  await delay(100);
  return {
    rawSnapdom: raw,
    operation: {
      mutations: [...mutations],
      leftAfterCapture: [
        ...document.querySelectorAll("[data-snapdom-internal]"),
      ].map(nodeName),
    },
  };
};

window.probe = {
  names: Object.keys(scenarios),
  async run(name) {
    resetRecording();
    try {
      return { ok: true, result: await scenarios[name]() };
    } catch (error) {
      return { ok: false, error: String(error?.stack ?? error), timeline };
    } finally {
      recordingMutations = false;
    }
  },
};
window.probeReady = true;
