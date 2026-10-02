import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { pendingFont, webFont } from "./fonts";
import { decode, isLosslessWebp, signature } from "./image";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  window.scrollTo(0, 0);
});

/** Two solid boxes fixed to the viewport, on a page with no background. */
const boxes = `
  <label style="position: fixed; left: 200px; top: 200px">Name <input></label>
  <div style="position: fixed; left: 10px; top: 20px; width: 30px; height: 40px; background: rgb(255, 0, 0)"></div>
  <div style="position: fixed; left: 100px; top: 100px; width: 50px; height: 50px; background: rgb(0, 0, 255)"></div>`;

/** A canvas of varied pixels, which any lossy encoding would change. */
function patternedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  canvas.style.display = "block";
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(64, 64);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = (i * 37) % 256;
    pixels.data[i + 1] = Math.floor(i / 256) % 256;
    pixels.data[i + 2] = (i * 19 + 83) % 256;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Another origin for the test server: `localhost` reaches it from a loopback
 * address, and from `localhost` whichever loopback address it listens on.
 */
async function crossOrigin(): Promise<string> {
  const hosts =
    location.hostname === "localhost" ? ["127.0.0.1", "[::1]"] : ["localhost"];
  for (const host of hosts) {
    const origin = `${location.protocol}//${host}:${location.port}`;
    const reachable = await fetch(`${origin}/__delay/0/probe.gif`, {
      mode: "no-cors",
    }).then(
      () => true,
      () => false
    );
    if (reachable) return origin;
  }
  throw new Error(`no other origin reaches ${location.origin}`);
}

/** A canvas a cross-origin image tainted, so its pixels cannot be read. */
async function taintedCanvas(): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = `${await crossOrigin()}/__delay/0/taint.gif`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 10;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  expect(() => canvas.getContext("2d")!.getImageData(0, 0, 1, 1)).toThrow();
  return canvas;
}

function withDevicePixelRatio<T>(ratio: number, run: () => Promise<T>) {
  // The window's own property; deleting the stub would delete it too.
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio")!;
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    get: () => ratio,
  });
  return run().finally(() =>
    Object.defineProperty(window, "devicePixelRatio", original)
  );
}

describe("Page.screenshot", () => {
  it("returns PNG bytes of the viewport", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = boxes;
    const bytes = await createPage().screenshot();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(signature(bytes)).toBe("png");
    const image = await decode(bytes);
    expect([image.width, image.height]).toEqual([innerWidth, innerHeight]);
    expect(image.pixel(25, 40)).toEqual([255, 0, 0, 255]);
    expect(image.pixel(125, 125)).toEqual([0, 0, 255, 255]);
    expect(image.pixel(60, 60)).toEqual([255, 255, 255, 255]);
  });

  it("captures the scrolled viewport", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = `
      <div style="height: 3000px"></div>
      <div style="position: absolute; left: 10px; top: 1000px; width: 20px; height: 20px; background: rgb(0, 128, 0)"></div>
      <div style="position: fixed; left: 50px; top: 10px; width: 20px; height: 20px; background: rgb(255, 0, 0)"></div>`;
    window.scrollTo(0, 990);
    const image = await decode(await createPage().screenshot());

    expect(image.pixel(20, 20)).toEqual([0, 128, 0, 255]);
    expect(image.pixel(60, 20)).toEqual([255, 0, 0, 255]);
    expect(window.scrollY).toBe(990);
  });

  it("keeps a top margin that collapses through the body", async () => {
    window.scrollTo(0, 0);
    document.body.style.margin = "0";
    document.body.innerHTML = `<div style="margin-top: 20px; height: 20px; background: rgb(0, 128, 0)"></div>`;
    const image = await decode(await createPage().screenshot());

    expect(image.pixel(5, 15)).toEqual([255, 255, 255, 255]);
    expect(image.pixel(5, 25)).toEqual([0, 128, 0, 255]);
  });

  it("maps device and CSS scale to the device pixel ratio", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = boxes;
    const page = createPage();

    await withDevicePixelRatio(2, async () => {
      const device = await decode(await page.screenshot());
      expect([device.width, device.height]).toEqual([
        innerWidth * 2,
        innerHeight * 2,
      ]);
      expect(device.pixel(50, 80)).toEqual([255, 0, 0, 255]);
      expect(device.pixel(250, 250)).toEqual([0, 0, 255, 255]);

      const css = await decode(await page.screenshot({ scale: "css" }));
      expect([css.width, css.height]).toEqual([innerWidth, innerHeight]);
      expect(css.pixel(25, 40)).toEqual([255, 0, 0, 255]);
    });
  });

  describe("on a scrolled page", () => {
    /**
     * A 600 x 3000 page scrolled to y = 1000, with content positioned in the
     * document, fixed to the viewport, stuck to it, and in a scrolled box.
     */
    async function scrolledPage() {
      document.body.style.cssText = "margin: 0; width: 600px; height: 3000px";
      document.body.innerHTML = `
        <div style="position: absolute; left: 0; top: 0; width: 20px; height: 20px; background: rgb(255, 0, 0)"></div>
        <div style="position: absolute; left: 0; top: 2000px; width: 20px; height: 20px; background: rgb(0, 0, 255)"></div>
        <div style="position: fixed; left: 50px; top: 50px; width: 20px; height: 20px; background: rgb(0, 255, 0)"></div>
        <div style="height: 400px"></div>
        <div style="position: sticky; top: 10px; margin-left: 100px; width: 20px; height: 20px; background: rgb(255, 255, 0)"></div>
        <div id="box" style="position: absolute; left: 200px; top: 1200px; width: 100px; height: 100px; overflow: hidden">
          <div style="height: 300px; padding-top: 150px; box-sizing: border-box">
            <div style="width: 20px; height: 20px; background: rgb(255, 0, 255)"></div>
          </div>
        </div>`;
      document.getElementById("box")!.scrollTop = 100;
      window.scrollTo(0, 1000);
      // The scroll event of the setup fires at the next animation frame.
      for (let frame = 0; frame < 2; frame++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const events: string[] = [];
      for (const type of ["scroll", "resize"])
        window.addEventListener(type, () => events.push(type));
      return events;
    }

    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const green = [0, 255, 0, 255];
    const yellow = [255, 255, 0, 255];
    const magenta = [255, 0, 255, 255];

    it("captures the full page as it is laid out at the scroll offset", async () => {
      const events = await scrolledPage();
      const image = await decode(
        await createPage().screenshot({ fullPage: true })
      );

      // Measured with Playwright 1.62.1: fixed and sticky content, and the
      // scrolled box's content, stay where the scroll offsets put them.
      expect([image.width, image.height]).toEqual([600, 3000]);
      expect(image.pixel(5, 5)).toEqual(red);
      expect(image.pixel(5, 2005)).toEqual(blue);
      expect(image.pixel(55, 1055)).toEqual(green);
      expect(image.pixel(105, 1015)).toEqual(yellow);
      expect(image.pixel(205, 1255)).toEqual(magenta);
      expect([window.scrollX, window.scrollY]).toEqual([0, 1000]);
      expect(document.getElementById("box")!.scrollTop).toBe(100);
      expect(events).toEqual([]);
    });

    it("rejects a full page beyond the renderer's size limit", async () => {
      document.body.style.cssText = "margin: 0; height: 40000px";
      // Measured with Playwright 1.62.1, which returns the 40000 px image.
      await expect(createPage().screenshot({ fullPage: true })).rejects.toThrow(
        "page.screenshot: the capture is incomplete: capture 414x40000px exceeds decode limits"
      );
    });

    it("clips in viewport coordinates without fullPage", async () => {
      const events = await scrolledPage();
      const image = await decode(
        await createPage().screenshot({
          clip: { x: 40, y: 40, width: 40, height: 40 },
        })
      );

      expect([image.width, image.height]).toEqual([40, 40]);
      expect(image.pixel(15, 15)).toEqual(green);
      expect(image.pixel(5, 5)).toEqual([255, 255, 255, 255]);
      expect(window.scrollY).toBe(1000);
      expect(events).toEqual([]);
    });

    it("clips in document coordinates with fullPage", async () => {
      await scrolledPage();
      const image = await decode(
        await createPage().screenshot({
          fullPage: true,
          clip: { x: 0, y: 1990, width: 50, height: 50 },
        })
      );

      expect([image.width, image.height]).toEqual([50, 50]);
      expect(image.pixel(5, 15)).toEqual(blue);
      expect(window.scrollY).toBe(1000);
    });

    it("trims the clip to the viewport or the full page", async () => {
      await scrolledPage();
      const page = createPage();
      const trimmed = await decode(
        await page.screenshot({
          clip: { x: innerWidth - 14, y: -10, width: 100, height: 30 },
        })
      );
      expect([trimmed.width, trimmed.height]).toEqual([14, 20]);

      const full = await decode(
        await page.screenshot({
          fullPage: true,
          clip: { x: 590, y: 2990, width: 100, height: 100 },
        })
      );
      expect([full.width, full.height]).toEqual([10, 10]);

      for (const options of [
        { clip: { x: innerWidth, y: 0, width: 10, height: 10 } },
        { fullPage: true, clip: { x: 0, y: 3000, width: 10, height: 10 } },
      ])
        await expect(page.screenshot(options)).rejects.toThrow(
          new Error(
            "page.screenshot: Clipped area is either empty or outside the resulting image\nCall log:\n  - taking page screenshot\n  - waiting for fonts to load...\n  - fonts loaded"
          )
        );
    });

    it("rounds a fractional clip as Chromium does", async () => {
      await scrolledPage();
      const page = createPage();
      const clip = { x: 10.5, y: 20.25, width: 100.3, height: 50.6 };
      // Measured with Playwright 1.62.1: the origin rounds to the nearest
      // device pixel and the size truncates to whole CSS pixels.
      const css = await decode(await page.screenshot({ clip }));
      expect([css.width, css.height]).toEqual([100, 50]);
      expect(css.pixel(39, 30)).toEqual(green);
      expect(css.pixel(38, 30)).toEqual([255, 255, 255, 255]);
      expect(css.pixel(39, 29)).toEqual([255, 255, 255, 255]);

      await withDevicePixelRatio(2, async () => {
        const device = await decode(await page.screenshot({ clip }));
        expect([device.width, device.height]).toEqual([200, 100]);
        expect(device.pixel(79, 59)).toEqual(green);
        expect(device.pixel(78, 59)).toEqual([255, 255, 255, 255]);
        expect(device.pixel(79, 58)).toEqual([255, 255, 255, 255]);
      });

      await expect(
        page.screenshot({ clip: { x: 0, y: 0, width: 0.5, height: 1 } })
      ).rejects.toThrow(
        "page.screenshot: Cannot take screenshot with 0 width."
      );
    });

    it("checks content in the captured region only", async () => {
      await scrolledPage();
      const canvas = await taintedCanvas();
      canvas.style.cssText = "position: absolute; left: 0; top: 2500px";
      document.body.append(canvas);
      const page = createPage();

      expect(signature(await page.screenshot())).toBe("png");
      expect(
        signature(
          await page.screenshot({
            fullPage: true,
            clip: { x: 0, y: 0, width: 600, height: 2400 },
          })
        )
      ).toBe("png");
      await expect(page.screenshot({ fullPage: true })).rejects.toThrow(
        "its pixels cannot be read back"
      );
    });
  });

  it("encodes JPEG at quality 80 by default", async () => {
    document.body.appendChild(patternedCanvas());
    const page = createPage();
    const byDefault = await page.screenshot({ type: "jpeg" });
    const at80 = await page.screenshot({ type: "jpeg", quality: 80 });
    const at0 = await page.screenshot({ type: "jpeg", quality: 0 });

    expect(signature(byDefault)).toBe("jpeg");
    expect(byDefault).toEqual(at80);
    expect(at0.byteLength).toBeLessThan(byDefault.byteLength);
  });

  it("encodes lossless WebP at the default quality 100", async () => {
    document.body.style.margin = "0";
    document.body.appendChild(patternedCanvas());
    const page = createPage();
    const byDefault = await page.screenshot({ type: "webp" });
    const lossy = await page.screenshot({ type: "webp", quality: 80 });

    expect(signature(byDefault)).toBe("webp");
    expect(isLosslessWebp(byDefault)).toBe(true);
    expect(isLosslessWebp(lossy)).toBe(false);
    const webp = await decode(byDefault);
    const png = await decode(await page.screenshot());
    expect(webp.data).toEqual(png.data);
    const source = document
      .querySelector("canvas")!
      .getContext("2d")!
      .getImageData(0, 0, 64, 64).data;
    expect(webp.pixel(63, 63)).toEqual(Array.from(source.subarray(-4)));
    expect(webp.pixel(5, 9)).toEqual(
      Array.from(source.subarray((9 * 64 + 5) * 4, (9 * 64 + 5) * 4 + 4))
    );
  });

  it("omits the default background but keeps authored ones", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = `
      <div style="width: 300px; height: 100px; background: black"></div>
      <div style="width: 300px; height: 100px; background: white"></div>
      <div style="width: 300px; height: 100px; background: transparent"></div>`;
    const page = createPage();

    for (const type of ["png", "webp"] as const) {
      const image = await decode(
        await page.screenshot({ omitBackground: true, type })
      );
      expect(image.pixel(150, 50), type).toEqual([0, 0, 0, 255]);
      expect(image.pixel(150, 150), type).toEqual([255, 255, 255, 255]);
      expect(image.pixel(150, 250)[3], type).toBe(0);
    }
    const jpeg = await decode(
      await page.screenshot({ omitBackground: true, type: "jpeg" })
    );
    expect(jpeg.pixel(150, 250).slice(0, 3)).toEqual([255, 255, 255]);
    const opaque = await decode(await page.screenshot());
    expect(opaque.pixel(150, 250)).toEqual([255, 255, 255, 255]);
  });

  it("paints the root background over the whole viewport", async () => {
    document.body.style.cssText = "margin: 20px; background: rgb(0, 128, 0)";
    const bodyBackground = await decode(
      await createPage().screenshot({ omitBackground: true })
    );
    expect(bodyBackground.pixel(5, 5)).toEqual([0, 128, 0, 255]);

    document.documentElement.style.background = "rgb(0, 0, 255)";
    const rootBackground = await decode(await createPage().screenshot());
    expect(rootBackground.pixel(5, 5)).toEqual([0, 0, 255, 255]);
    expect(rootBackground.pixel(40, 40)).toEqual([0, 128, 0, 255]);
  });

  it("accepts both caret values without changing the document", async () => {
    document.body.innerHTML = `<input style="caret-color: red" autofocus>`;
    const input = document.querySelector("input")!;
    input.focus();
    const page = createPage();
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      observed.push(...records)
    );
    observer.observe(document, { attributes: true, subtree: true });

    await page.screenshot({ caret: "hide" });
    await page.screenshot({ caret: "initial" });
    observer.disconnect();
    expect(observed).toEqual([]);
    expect(input.style.caretColor).toBe("red");
  });

  it("accepts the default forms of options that have not landed", async () => {
    const page = createPage();
    for (const options of [
      { fullPage: false },
      { mask: [] },
      { maskColor: "#00FF00" },
      { style: "" },
      { animations: "allow" as const },
    ])
      expect(signature(await page.screenshot(options))).toBe("png");
  });

  it("rejects options that have not landed and the path option", async () => {
    const page = createPage();
    const cases: [object, string][] = [
      [{ path: "shot.png" }, "the `path` option is not supported"],
      [
        { mask: [page.locator("body")] },
        "the `mask` option is not supported yet.",
      ],
      [{ style: "body {}" }, "the `style` option is not supported yet."],
      [
        { animations: "disabled" },
        '`animations: "disabled"` is not supported yet.',
      ],
    ];
    for (const [options, message] of cases)
      await expect(page.screenshot(options)).rejects.toThrow(
        `page.screenshot: ${message}`
      );
  });

  it("validates options as pinned Playwright does", async () => {
    const page = createPage();
    const cases: [object, string][] = [
      [
        { quality: 50 },
        "options.quality is unsupported for the png screenshots",
      ],
      [
        { type: "png", quality: 0 },
        "options.quality is unsupported for the png",
      ],
      [{ type: "gif" }, "type: expected one of (png|jpeg|webp)"],
      [
        { type: "jpeg", quality: 101 },
        "Expected options.quality to be between 0 and 100 (inclusive), got 101",
      ],
      [
        { type: "webp", quality: -1 },
        "Expected options.quality to be between 0 and 100 (inclusive), got -1",
      ],
      [
        { type: "jpeg", quality: 50.5 },
        "quality: expected integer, got float 50.5",
      ],
      [{ type: "jpeg", quality: "5" }, "quality: expected integer, got string"],
      [{ caret: "x" }, "caret: expected one of (hide|initial)"],
      [{ scale: "x" }, "scale: expected one of (css|device)"],
      [{ animations: "x" }, "animations: expected one of (disabled|allow)"],
      [{ omitBackground: "x" }, "omitBackground: expected boolean, got string"],
      [{ fullPage: 1 }, "fullPage: expected boolean, got number"],
      [{ maskColor: 5 }, "maskColor: expected string, got number"],
      [{ style: 5 }, "style: expected string, got number"],
      [{ mask: 5 }, "mask: expected array, got number"],
      [
        { clip: { x: "0", y: 0, width: 1, height: 1 } },
        "clip.x: expected float, got string",
      ],
      [
        { clip: { x: 0, y: 0, width: 0, height: 1 } },
        "Expected options.clip.width to be greater than 0.",
      ],
      [
        { clip: { x: 0, y: 0, width: 1, height: -1 } },
        "Expected options.clip.height to be greater than 0.",
      ],
      [
        {
          type: "jpeg",
          quality: 101,
          clip: { x: 0, y: 0, width: 0, height: 1 },
        },
        "Expected options.quality to be between 0 and 100 (inclusive), got 101",
      ],
    ];
    for (const [options, message] of cases)
      await expect(
        page.screenshot(options as never),
        JSON.stringify(options)
      ).rejects.toThrow(`page.screenshot: ${message}`);
  });

  it("waits for fonts to load within the deadline", async () => {
    pendingFont(300);
    const page = createPage();
    const error = await page.screenshot({ timeout: 50 }).catch((e) => e);

    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe(
      "page.screenshot: Timeout 50ms exceeded.\nCall log:\n  - taking page screenshot\n  - waiting for fonts to load..."
    );
    expect(signature(await page.screenshot({ timeout: 5_000 }))).toBe("png");
    expect(document.fonts.status).toBe("loaded");
  });

  it("captures a readable canvas without touching its context", async () => {
    document.body.style.margin = "0";
    const drawn = patternedCanvas();
    const blank = document.createElement("canvas");
    document.body.append(drawn, blank);
    const context = drawn.getContext("2d")!;
    context.fillStyle = "#123456";
    context.globalAlpha = 0.5;
    const before = context.getImageData(0, 0, 64, 64).data;

    const image = await decode(await createPage().screenshot());

    expect(image.pixel(5, 9)).toEqual(
      Array.from(before.subarray((9 * 64 + 5) * 4, (9 * 64 + 5) * 4 + 4))
    );
    expect(context.fillStyle).toBe("#123456");
    expect(context.globalAlpha).toBe(0.5);
    expect(context.getImageData(0, 0, 64, 64).data).toEqual(before);
    // A canvas with no context still has none, so the page can pick any.
    expect(
      blank.getContext("webgl2") ?? blank.getContext("webgl")
    ).not.toBeNull();
  });

  it("rejects a tainted canvas in the viewport but not one outside it", async () => {
    document.body.style.margin = "0";
    const canvas = await taintedCanvas();
    canvas.id = "tainted";
    canvas.style.cssText = "position: absolute; left: 0; top: 3000px";
    document.body.append(canvas);
    const page = createPage();

    expect(signature(await page.screenshot())).toBe("png");
    canvas.style.top = "10px";
    await expect(page.screenshot()).rejects.toThrow(
      'page.screenshot: cannot capture <canvas width="10" height="10" id="tainted"></canvas>: its pixels cannot be read back, since cross-origin content tainted it.'
    );
  });

  it("rejects an image the renderer could not load", async () => {
    document.body.innerHTML = `<img src="/missing-screenshot-image.png" alt="">`;
    await expect(createPage().screenshot()).rejects.toThrow(
      /^page\.screenshot: the capture is incomplete: image failed to inline, using placeholder: .*missing-screenshot-image\.png/
    );
  });

  it("rejects media whose substitution the renderer does not report", async () => {
    const page = createPage();
    const cases: [string, string][] = [
      ["<video></video>", "capturing <video> content is not supported yet."],
      [
        '<iframe srcdoc="x"></iframe>',
        "capturing <iframe> content is not supported yet.",
      ],
      [
        '<div style="width: 10px; height: 10px; background-image: url(/__delay/0/a.gif)"></div>',
        "capturing a CSS background-image from a URL is not supported yet.",
      ],
      [
        '<div style="width: 10px; height: 10px; mask-image: url(/__delay/0/a.gif)"></div>',
        "capturing a CSS mask-image from a URL is not supported yet.",
      ],
      [
        '<ul><li style="list-style-image: url(/__delay/0/a.gif)">x</li></ul>',
        "capturing a CSS list-style-image from a URL is not supported yet.",
      ],
      [
        '<svg width="10" height="10"><image href="/__delay/0/a.gif" width="10" height="10"></image></svg>',
        "capturing an SVG image from a URL is not supported yet.",
      ],
    ];
    for (const [markup, message] of cases) {
      document.body.innerHTML = markup;
      await expect(page.screenshot(), markup).rejects.toThrow(message);
    }
  });

  it("renders text in a loaded web font", async () => {
    // Each glyph of the pinned fixture font is a filled black rectangle.
    const ink = async (font: string) => {
      document.body.innerHTML = `<span style="font: 40px ${font}">+-</span>`;
      await document.fonts.ready;
      const box = document.body.firstElementChild!.getBoundingClientRect();
      const image = await decode(await createPage().screenshot());
      let dark = 0;
      for (let y = Math.ceil(box.top); y < Math.floor(box.bottom); y++)
        for (let x = Math.ceil(box.left); x < Math.floor(box.right); x++)
          if (image.pixel(x, y)[0] < 64) dark++;
      return dark;
    };
    await webFont("pwtest-font");

    expect(await ink("pwtest-font, serif")).toBeGreaterThan(
      4 * (await ink("serif"))
    );
  });

  it("rejects text in a web font the renderer would not embed", async () => {
    // SnapDOM skips families named like icon fonts.
    await webFont("pwtest-iconfont");
    document.body.innerHTML = `<p style="font-family: pwtest-iconfont">+-</p>`;
    await expect(createPage().screenshot()).rejects.toThrow(
      'page.screenshot: cannot capture <p>+-</p>: its text uses the "pwtest-iconfont" web font, which the renderer could not embed.'
    );

    document.body.innerHTML = `<style>i::before { content: "+"; font-family: pwtest-iconfont }</style><i id="icon"></i>`;
    await expect(createPage().screenshot()).rejects.toThrow(
      'page.screenshot: cannot capture <i id="icon"></i>: its text uses the "pwtest-iconfont" web font'
    );

    // It embeds fonts from style sheets only, not ones added through the API.
    const face = new FontFace(
      "pwtest-api-font",
      "url(/tests/assets/webfont/iconfont.woff2)"
    );
    document.fonts.add(await face.load());
    try {
      document.body.innerHTML = `<p style="font-family: pwtest-api-font">+-</p>`;
      await expect(createPage().screenshot()).rejects.toThrow(
        'page.screenshot: cannot capture <p>+-</p>: its text uses the "pwtest-api-font" web font, which the renderer could not embed.'
      );
    } finally {
      document.fonts.delete(face);
    }

    // Text in another font, and an element without text, are captured.
    document.body.innerHTML = `<p style="font-family: serif, pwtest-iconfont">+-</p><div style="font-family: pwtest-iconfont"></div>`;
    await createPage().screenshot();
  });

  it("leaves none of the renderer's elements in the document", async () => {
    const leftovers = () =>
      document.querySelectorAll("iframe, #snapdom-sandbox").length;
    document.body.innerHTML = boxes;
    await createPage().screenshot();
    expect(leftovers()).toBe(0);

    document.body.innerHTML = `${boxes}<img src="/__delay/300/slow.gif">`;
    const page = createPage();
    await expect(page.screenshot({ timeout: 100 })).rejects.toThrow(
      "page.screenshot: Timeout 100ms exceeded."
    );
    await page.screenshot({ timeout: 5_000 });
    expect(leftovers()).toBe(0);
  });

  it("captures data URL images and media outside the viewport", async () => {
    document.body.innerHTML = `
      <div style="width: 10px; height: 10px; background-image: url('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')"></div>
      <div style="position: absolute; top: 4000px"><video></video><iframe></iframe></div>`;
    expect(signature(await createPage().screenshot())).toBe("png");
  });

  it("checks a pseudo-element that can paint into the viewport from outside it", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = `
      <style>#m::before { content: ""; position: absolute; left: 60px; width: 10px; height: 10px; background-image: url(/__delay/0/a.gif) }</style>
      <div id="m" style="position: absolute; left: -50px; top: 0; width: 20px; height: 20px"></div>`;
    const page = createPage();
    await expect(page.screenshot()).rejects.toThrow(
      "capturing a CSS background-image from a URL is not supported yet."
    );
    // An element that clips the pseudo-element keeps it outside.
    document.getElementById("m")!.style.overflow = "hidden";
    expect(signature(await page.screenshot())).toBe("png");
  });

  it("keeps later captures independent of an abandoned one", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = boxes;
    pendingFont(200);
    const page = createPage();
    const controller = new AbortController();
    const abandoned = page.screenshot({
      signal: controller.signal,
      timeout: 0,
    });
    controller.abort(new Error("stop"));
    await expect(abandoned).rejects.toThrow("page.screenshot: stop");

    const image = await decode(await page.screenshot({ timeout: 5_000 }));
    expect(image.pixel(25, 40)).toEqual([255, 0, 0, 255]);
  });

  it("serializes overlapping captures from two pages of one document", async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = boxes;
    const [first, second] = [createPage(), createPage()];
    const results = await Promise.all([
      first.screenshot(),
      second.screenshot({ type: "jpeg" }),
      first.screenshot({ scale: "css" }),
    ]);

    expect(results.map(signature)).toEqual(["png", "jpeg", "png"]);
    for (const bytes of [results[0], results[2]])
      expect((await decode(bytes)).pixel(25, 40)).toEqual([255, 0, 0, 255]);
  });
});
