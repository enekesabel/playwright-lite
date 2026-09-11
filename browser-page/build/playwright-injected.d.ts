declare module "virtual:ayme-playwright-injected" {
  export type CaptureAriaSnapshotResult = {
    distilledText: string;
    fullText: string;
    refsByElement: Map<Element, string>;
  };

  type InjectedScriptOptions = {
    browserName: string;
    customEngines: Array<{ name: string; source: string }>;
    frameSeq: number;
    isUnderTest: boolean;
    isUtilityWorld: boolean;
    sdkLanguage: string;
    shouldPrependErrorPrefix: boolean;
    stableRafCount: number;
    testIdAttributeName: string;
  };

  export type ParsedSelector = {
    parts: Array<{ name: string; body: unknown }>;
    capture?: number;
  };

  export function parseAriaSnapshot(text: string): unknown;

  export function getByTestIdSelector(
    testIdAttributeName: string,
    testId: string | RegExp
  ): string;

  export type ElementStateResult =
    | { matches: true; received: string }
    | { matches: false; received: string }
    | { matches: false; received: "error:notconnected" };

  export class InjectedScript {
    constructor(browserWindow: Window, options: InjectedScriptOptions);
    ariaSnapshot(
      node: Element,
      options: {
        boxes?: boolean;
        depth?: number;
        mode: "ai" | "default";
      }
    ): string;
    captureAriaSnapshot(root: Element): CaptureAriaSnapshotResult;
    parseSelector(selector: string): ParsedSelector;
    querySelector(
      selector: ParsedSelector,
      root: Node,
      strict?: boolean
    ): Element | undefined;
    querySelectorAll(selector: ParsedSelector, root: Node): Element[];
    setInputFiles(
      node: Node,
      payloads: { name: string; mimeType: string; buffer: string }[]
    ): string | undefined;
    elementState(
      node: Element,
      state: "visible" | "hidden" | "enabled" | "disabled" | "editable"
    ): ElementStateResult;
  }
}
