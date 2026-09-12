declare module "virtual:playwright-lite-injected" {
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

declare module "virtual:playwright-lite-evaluation" {
  export function serializeValue(
    value: unknown,
    handleSerializer: (
      value: unknown
    ) => { h: number } | { fallThrough: unknown }
  ): unknown;
  export function parseSerializedValue(
    value: unknown,
    handles?: unknown[]
  ): unknown;
  export function serializeAsCallArgument(
    value: unknown,
    handleSerializer: (
      value: unknown
    ) => { h: number } | { fallThrough: unknown }
  ): unknown;
  export function parseEvaluationResultValue(
    value: unknown,
    handles?: unknown[]
  ): unknown;
  export class UtilityScript {
    constructor(global: Window & typeof globalThis, isUnderTest: boolean);
    evaluate(
      isFunction: boolean,
      returnByValue: boolean,
      expression: string,
      argCount: number,
      ...argsAndHandles: unknown[]
    ): unknown;
    jsonValue(returnByValue: true, value: unknown): unknown;
  }
}
