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
import { TargetClosedError } from "./lifetime";
import type { PageImpl } from "./page";

export type EvaluationFunction<R = any> =
  string | ((...args: any[]) => R | Promise<R>);

export type EvaluationOptions = { exposeFunctions?: boolean };

/** The value an evaluation runs against: a `this` for the page function. */
type EvaluationTarget = Element | Element[] | AdapterJSHandle;

/** Uses the pinned UtilityScript for by-value calls without a browser protocol. */
export class Evaluation {
  private utility: UtilityScript | undefined;

  /** `page` is also the owner of this evaluation's handles. */
  constructor(readonly page: PageImpl) {}

  private get script(): UtilityScript {
    return (this.utility ??= new UtilityScript(this.page.window, false));
  }

  /**
   * `exposeFunctions` registers each function nested in `value` as a binding
   * (pinned client/jsHandle.ts `serializeArgumentWithCallbacks`) instead of
   * letting the protocol serializer reject it; its generated name survives
   * the value copy and is what the pinned UtilityScript's own serializer
   * (`serializeAsCallArgument`) recognizes to re-emit `{ fn }` for the
   * reconstructed callable the page function receives.
   */
  private argument(value: unknown, exposeFunctions = false) {
    // Preserve handle wrappers across the client/server value copy, then let
    // the utility serializer replace them with the controlled browser objects.
    const references: unknown[] = [];
    const protocolValue = serializeValue(value, (candidate) => {
      if (candidate instanceof AdapterJSHandle) {
        references.push(candidate);
        return { h: references.length - 1 };
      }
      if (exposeFunctions && typeof candidate === "function") {
        return {
          fn: this.page.bindings.registerEvaluateCallback(
            this.page.bindingOwner,
            candidate as (...args: unknown[]) => unknown
          ),
        };
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

  /**
   * Pinned crExecutionContext.ts:142 answers a node with an ElementHandle: the
   * protocol reports it as a remote-object subtype, which in the document is
   * `instanceof Node`, the constructor as it was when the adapter loaded.
   */
  handleFor(value: unknown): AdapterJSHandle {
    return value instanceof Node
      ? new AdapterElementHandle(this.page, value as Element)
      : new AdapterJSHandle(value, this);
  }

  async byValue<R>(
    expression: EvaluationFunction<R>,
    isFunction: boolean,
    arg?: unknown,
    target?: EvaluationTarget,
    options?: EvaluationOptions
  ): Promise<R> {
    const result = await this.run(
      expression,
      isFunction,
      true,
      arg,
      target,
      options?.exposeFunctions
    );
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
    target?: EvaluationTarget,
    options?: EvaluationOptions
  ): Promise<AdapterJSHandle> {
    return this.handleFor(
      await this.run(
        expression,
        isFunction,
        false,
        arg,
        target,
        options?.exposeFunctions
      )
    );
  }

  private async run(
    expression: EvaluationFunction,
    isFunction: boolean,
    returnByValue: boolean,
    arg: unknown,
    target: EvaluationTarget | undefined,
    exposeFunctions?: boolean
  ): Promise<unknown> {
    if (this.page.lifetime.closed) throw new TargetClosedError();
    const normalized = normalizeExpression(String(expression), isFunction);
    const { serialized, handles } = this.argument(arg, exposeFunctions);
    const parameters = [serialized];
    if (target !== undefined) {
      handles.push(
        target instanceof AdapterJSHandle
          ? target.valueForEvaluation(this)
          : target
      );
      parameters.unshift({ h: handles.length - 1 });
    }
    let evaluated: Promise<unknown>;
    try {
      evaluated = Promise.resolve(
        this.script.evaluate(
          isFunction,
          returnByValue,
          normalized,
          parameters.length,
          ...parameters,
          ...handles
        )
      ).catch((error: unknown) => {
        throw evaluationError(error);
      });
    } catch (error) {
      throw evaluationError(error);
    }
    // A page function cannot be stopped, so closing the page abandons it.
    return await this.page.lifetime.race(evaluated);
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

  /**
   * One round trip through the pinned by-value call-argument serializer,
   * resolving this page's handles to their referenced value. `exposeFunction`
   * / `exposeBinding` cross their arguments and result this way: there is no
   * Node/browser split to serialize across, so a binding call takes one hop
   * (the pinned browser-side `serializeAsCallArgument` alone), not the two
   * the pinned client and server each take. Unlike `unwrapHandles`, this
   * skips the protocol-level pass, so a `Window`/`Document`/`Node` argument
   * still aliases to the pinned `"ref: <Window>"`-style string instead of
   * losing its identity to the protocol serializer's plain-object walk first.
   */
  bindingValue(value: unknown): unknown {
    const handles: unknown[] = [];
    const serialized = serializeAsCallArgument(value, (candidate) => {
      if (candidate instanceof AdapterJSHandle) {
        handles.push(candidate.valueForEvaluation(this));
        return { h: handles.length - 1 };
      }
      return { fallThrough: candidate };
    });
    return parseEvaluationResultValue(serialized, handles);
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
