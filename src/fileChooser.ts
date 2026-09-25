import type { ElementHandle, Page } from "@playwright/test";
import type { AdapterElementHandle } from "./elementHandle";
import { HostObservation, perWindow, type HostMember } from "./hostGlobals";
import type { InputFiles } from "./inputFiles";
import { guardLifetimeCalls, type PageLifetime } from "./lifetime";

/**
 * Pinned client/fileChooser.ts: the file input the page activated, reported
 * once per activation to every `filechooser` listener of one page.
 */
export class FileChooser {
  static {
    guardLifetimeCalls(
      FileChooser.prototype,
      { setFiles: true },
      "fileChooser",
      (chooser) => chooser.lifetime
    );
  }

  constructor(
    private readonly _page: Page,
    private readonly lifetime: PageLifetime,
    private readonly _element: AdapterElementHandle,
    private readonly _isMultiple: boolean
  ) {}

  element(): ElementHandle {
    return this._element as unknown as ElementHandle;
  }

  isMultiple(): boolean {
    return this._isMultiple;
  }

  page(): Page {
    return this._page;
  }

  /** Pinned `setFiles` is its element's `setInputFiles`. */
  async setFiles(
    files: InputFiles,
    options?: Parameters<ElementHandle["setInputFiles"]>[1]
  ): Promise<void> {
    await this._element.assignInputFiles(
      files,
      options,
      "fileChooser.setFiles"
    );
  }
}

export type FileChooserReport = (input: HTMLInputElement) => void;

/** The one observation of a window's file inputs, shared by every `Page` created for it (see `networkObservationFor`). */
export const fileChooserObservationFor = perWindow(
  (browserWindow) => new FileChooserObservation(browserWindow)
);

type HostCall = (...args: unknown[]) => unknown;

/**
 * Reports each activation of an `<input type=file>` as Playwright's
 * `filechooser` event for as long as something is subscribed, in place of the
 * picker, which never opens meanwhile. Playwright asks the browser to hand it
 * the picker (pinned server/page.ts `setFileChooserInterceptedBy`); a
 * document can only stop the activation that would open it.
 *
 * Every activation but `showPicker()` is a `click` event on the input: a
 * user's or an adapter click, a click forwarded by a `<label>`, a key
 * activating it, or `input.click()`. A `window` listener sees each one that
 * reaches the document, runs the pinned `_onFileChooserOpened` in its place
 * and cancels the event, which is what keeps the picker closed. Replacing a
 * host function is the last resort (see `hostGlobals`), so only what no
 * listener can see is wrapped: `click()` on an input the `window` listener
 * cannot reach (one outside the document or inside a closed shadow root), and
 * `showPicker()`, which fires no event.
 */
export class FileChooserObservation {
  private readonly host: HostObservation<FileChooserReport>;

  constructor(private readonly window: Window & typeof globalThis) {
    const members: HostMember[] = [
      {
        holder: window.HTMLElement.prototype as unknown as Record<
          string,
          unknown
        >,
        name: "click",
        intercept: (original: HostCall, thisArg, args) =>
          this.observeClickCall(original, thisArg, args),
      },
    ];
    // Absent before Chromium 99, Firefox 101 and Safari 16.
    if (typeof window.HTMLInputElement.prototype.showPicker === "function")
      members.push({
        holder: window.HTMLInputElement.prototype as unknown as Record<
          string,
          unknown
        >,
        name: "showPicker",
        intercept: (original: HostCall, thisArg, args) =>
          this.observeShowPicker(original, thisArg, args),
      });
    this.host = new HostObservation(members, {
      onFirstSubscribe: () =>
        window.addEventListener("click", this.observeClick),
      onLastRelease: () =>
        window.removeEventListener("click", this.observeClick),
    });
  }

  /** Reports to `report` until the returned release is called. */
  subscribe(report: FileChooserReport): () => void {
    return this.host.subscribe(report);
  }

  /**
   * Registered on `window`, bubbling, so it runs after the listeners of every
   * node on the path. A click some listener already cancelled activates
   * nothing, and a disabled input opens no picker; neither is reported.
   */
  private readonly observeClick = (event: Event) => {
    const input = event.composedPath()[0];
    if (
      !(event instanceof this.window.MouseEvent) ||
      event.defaultPrevented ||
      !this.isFileInput(input) ||
      input.matches(":disabled")
    )
      return;
    event.preventDefault();
    this.host.report(input);
  };

  private observeClickCall(
    original: HostCall,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    if (!this.isFileInput(thisArg) || this.reachesWindow(thisArg))
      return Reflect.apply(original, thisArg, args);
    // The input's own tree root is the last node its click reaches that can
    // see the input; a listener per call keeps nested calls apart.
    const root = thisArg.getRootNode();
    const listener = (event: Event) => this.observeClick(event);
    root.addEventListener("click", listener);
    try {
      return Reflect.apply(original, thisArg, args);
    } finally {
      root.removeEventListener("click", listener);
    }
  }

  /**
   * The native call throws for a disabled input, so it runs for one. The
   * transient user activation the native call also requires is not checked:
   * an adapter click never grants it, where a Playwright click does.
   */
  private observeShowPicker(
    original: HostCall,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    if (!this.isFileInput(thisArg) || thisArg.matches(":disabled"))
      return Reflect.apply(original, thisArg, args);
    this.host.report(thisArg);
    return undefined;
  }

  private isFileInput(value: unknown): value is HTMLInputElement {
    return (
      value instanceof this.window.HTMLInputElement && value.type === "file"
    );
  }

  /** Whether a click on `node` reaches the `window` listener with `node` still visible as its target. */
  private reachesWindow(node: Node): boolean {
    let root = node.getRootNode();
    while (root instanceof this.window.ShadowRoot) {
      if (root.mode === "closed") return false;
      root = root.host.getRootNode();
    }
    return root === this.window.document;
  }
}
