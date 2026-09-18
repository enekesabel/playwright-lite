/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright evaluation accepts arbitrary JavaScript values. */
import {
  UtilityScript,
  serializeValue,
  parseSerializedValue,
  parseEvaluationResultValue,
  serializeAsCallArgument,
} from "virtual:playwright-lite-evaluation";

import { AdapterElementHandle } from "./elementHandle";
import { AdapterJSHandle } from "./jsHandle";
import type { PageImpl } from "./page";

export type EvaluationFunction<R = any> =
  string | ((...args: any[]) => R | Promise<R>);

export type EvaluationOptions = { exposeFunctions?: boolean };

/** The value an evaluation runs against: a `this` for the page function. */
type EvaluationTarget = Element | Element[] | AdapterJSHandle;

/** Uses the pinned UtilityScript for by-value calls without a browser protocol. */
export class Evaluation {
  private utility: UtilityScript | undefined;
  /**
   * The pinned protocol reports a node as a remote-object subtype. In the
   * document that test is `instanceof Node`, so the constructor is captured
   * before a page script can delete the global.
   */
  private readonly node: typeof Node;

  constructor(private readonly page: PageImpl) {
    this.node = page.window.Node;
  }

  private get script(): UtilityScript {
    return (this.utility ??= new UtilityScript(this.page.window, false));
  }

  private argument(value: unknown) {
    // Preserve handle wrappers across the client/server value copy, then let
    // the utility serializer replace them with the controlled browser objects.
    const references: unknown[] = [];
    const protocolValue = serializeValue(value, (candidate) => {
      if (candidate instanceof AdapterJSHandle) {
        references.push(candidate);
        return { h: references.length - 1 };
      }
      return { fallThrough: candidate };
    });
    const copy = parseSerializedValue(protocolValue, references);
    const handles: unknown[] = [];
    const serialized = serializeAsCallArgument(copy, (candidate) => {
      if (candidate instanceof AdapterJSHandle) {
        handles.push(candidate.valueForEvaluation(this));
        return { h: handles.length - 1 };
      }
      return { fallThrough: candidate };
    });
    return { serialized, handles };
  }

  /** Replaces the handles inside a protocol argument with their values. */
  unwrapHandles(value: unknown): unknown {
    const { serialized, handles } = this.argument(value);
    return parseEvaluationResultValue(serialized, handles);
  }

  /** Pinned crExecutionContext.ts:142 answers a node with an ElementHandle. */
  handleFor(value: unknown): AdapterJSHandle {
    return value instanceof this.node
      ? new AdapterElementHandle(this.page, value as Element)
      : new AdapterJSHandle(value, this);
  }

  async byValue<R>(
    expression: EvaluationFunction<R>,
    isFunction: boolean,
    arg?: unknown,
    target?: EvaluationTarget
  ): Promise<R> {
    const result = await this.run(expression, isFunction, true, arg, target);
    return protocolResult(parseEvaluationResultValue(result)) as R;
  }

  /**
   * Pinned javascript.ts:249 evaluates with `returnByValue: false`, and the
   * protocol's `awaitPromise` settles a returned promise before it hands back
   * the handle.
   */
  async byHandle(
    expression: EvaluationFunction,
    isFunction: boolean,
    arg?: unknown,
    target?: EvaluationTarget
  ): Promise<AdapterJSHandle> {
    return this.handleFor(
      await this.run(expression, isFunction, false, arg, target)
    );
  }

  private async run(
    expression: EvaluationFunction,
    isFunction: boolean,
    returnByValue: boolean,
    arg: unknown,
    target: EvaluationTarget | undefined
  ): Promise<unknown> {
    const normalized = normalizeExpression(String(expression), isFunction);
    const { serialized, handles } = this.argument(arg);
    const parameters = [serialized];
    if (target !== undefined) {
      handles.push(
        target instanceof AdapterJSHandle
          ? target.valueForEvaluation(this)
          : target
      );
      parameters.unshift({ h: handles.length - 1 });
    }
    try {
      return await this.script.evaluate(
        isFunction,
        returnByValue,
        normalized,
        parameters.length,
        ...parameters,
        ...handles
      );
    } catch (error) {
      throw evaluationError(error);
    }
  }

  /**
   * Deserialize once, retaining predicate argument state across polls.
   *
   * The returned poll accepts the element a `Locator` predicate is called on,
   * which the pinned element form passes ahead of the argument
   * (`server/frames.ts` `waitForFunctionExpressionOnElement`).
   */
  predicate(
    expression: EvaluationFunction,
    isFunction: boolean,
    arg?: unknown
  ): (target?: Element) => unknown {
    const normalized = normalizeExpression(String(expression), isFunction);
    const { serialized, handles } = this.argument(arg);
    const argument = parseEvaluationResultValue(serialized, handles);
    let callback: ((...args: unknown[]) => unknown) | undefined;
    return (target?: Element) => {
      try {
        const result = callback ?? this.page.window.eval(normalized);
        if (isFunction) callback = result;
        const value = isFunction
          ? callback!(
              ...(target === undefined ? [argument] : [target, argument])
            )
          : result;
        if (value && typeof (value as Promise<unknown>).then === "function")
          return Promise.resolve(value).catch((error) => {
            throw evaluationError(error);
          });
        return value;
      } catch (error) {
        throw evaluationError(error);
      }
    };
  }

  jsonValue<T>(value: T): T {
    return protocolResult(
      parseEvaluationResultValue(this.script.jsonValue(true, value))
    ) as T;
  }
}

function protocolResult(value: unknown): unknown {
  return parseSerializedValue(
    serializeValue(value, (value) => ({ fallThrough: value }))
  );
}

// Pinned server/javascript.ts normalizes method shorthand before evaluating it.
function normalizeExpression(expression: string, isFunction: boolean): string {
  let result = expression.trim();
  if (isFunction) {
    try {
      new Function("(" + result + ")");
    } catch {
      result = result.startsWith("async ")
        ? "async function " + result.substring("async ".length)
        : "function " + result;
      try {
        new Function("(" + result + ")");
      } catch {
        throw new Error("Passed function is not well-serializable!");
      }
    }
  }
  if (/^(async)?\s*function(\s|\()/.test(result)) result = "(" + result + ")";
  return result;
}

function evaluationError(error: unknown): Error {
  // The browser evaluation delegate wraps callback exceptions in
  // JavaScriptErrorInEvaluate: an Error whose message retains the browser description.
  return new Error(
    error instanceof Error ? error.stack || String(error) : String(error)
  );
}
