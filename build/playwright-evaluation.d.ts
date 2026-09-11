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
