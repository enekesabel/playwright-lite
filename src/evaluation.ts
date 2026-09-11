/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright evaluation accepts arbitrary JavaScript values. */
import {
  UtilityScript,
  serializeValue,
  parseSerializedValue,
  parseEvaluationResultValue,
  serializeAsCallArgument,
} from "virtual:playwright-lite-evaluation";

import { AdapterElementHandle } from "./elementHandle";
import type { PageImpl } from "./page";

export type EvaluationFunction<R = any> =
  string | ((...args: any[]) => R | Promise<R>);

export type EvaluationOptions = { exposeFunctions?: boolean };

const invalidArguments =
  "Too many arguments. If you need to pass more than 1 argument to the function wrap them in an object.";

export function assertEvaluationOptions(options?: EvaluationOptions): void {
  if (
    options !== undefined &&
    (typeof options !== "object" || options === null || Array.isArray(options))
  )
    throw new Error(invalidArguments);
  if (options?.exposeFunctions === true)
    throw new Error("Unsupported Playwright option: evaluate.exposeFunctions");
  if (
    options?.exposeFunctions !== undefined &&
    typeof options.exposeFunctions !== "boolean"
  )
    throw new Error("exposeFunctions must be a boolean");
}

export function assertMaxArguments(count: number, maximum: number): void {
  if (count > maximum) throw new Error(invalidArguments);
}

/** Uses the pinned UtilityScript for by-value calls without a browser protocol. */
export class Evaluation {
  private utility: UtilityScript | undefined;

  constructor(private readonly page: PageImpl) {}

  private get script(): UtilityScript {
    return (this.utility ??= new UtilityScript(this.page.window, false));
  }

  private argument(value: unknown) {
    // Preserve handle wrappers across the client/server value copy, then let
    // the utility serializer replace them with the controlled browser objects.
    const references: unknown[] = [];
    const protocolValue = serializeValue(value, (candidate) => {
      if (
        candidate instanceof AdapterElementHandle ||
        candidate instanceof AdapterJSHandle
      ) {
        references.push(candidate);
        return { h: references.length - 1 };
      }
      return { fallThrough: candidate };
    });
    const copy = parseSerializedValue(protocolValue, references);
    const handles: unknown[] = [];
    const serialized = serializeAsCallArgument(copy, (candidate) => {
      if (candidate instanceof AdapterElementHandle) {
        handles.push(candidate.elementForEvaluation(this.page));
        return { h: handles.length - 1 };
      }
      if (candidate instanceof AdapterJSHandle) {
        handles.push(candidate.valueForEvaluation(this));
        return { h: handles.length - 1 };
      }
      return { fallThrough: candidate };
    });
    return { serialized, handles };
  }

  async byValue<R>(
    expression: EvaluationFunction<R>,
    isFunction: boolean,
    arg?: unknown,
    target?: Element | Element[]
  ): Promise<R> {
    const normalized = normalizeExpression(String(expression), isFunction);
    const { serialized, handles } = this.argument(arg);
    const parameters = [serialized];
    if (target !== undefined) {
      handles.push(target);
      parameters.unshift({ h: handles.length - 1 });
    }
    try {
      const result = await this.script.evaluate(
        isFunction,
        true,
        normalized,
        parameters.length,
        ...parameters,
        ...handles
      );
      return protocolResult(parseEvaluationResultValue(result)) as R;
    } catch (error) {
      throw evaluationError(error);
    }
  }

  /** Deserialize once, retaining predicate argument state across polls. */
  predicate(
    expression: EvaluationFunction,
    isFunction: boolean,
    arg?: unknown
  ): () => unknown {
    const normalized = normalizeExpression(String(expression), isFunction);
    const { serialized, handles } = this.argument(arg);
    const argument = parseEvaluationResultValue(serialized, handles);
    let callback: ((arg: unknown) => unknown) | undefined;
    return () => {
      try {
        const result = callback ?? this.page.window.eval(normalized);
        if (isFunction) callback = result;
        const value = isFunction ? callback!(argument) : result;
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

/** The existing waitForFunction handle. Additional JSHandle methods are unsupported. */
export class AdapterJSHandle<T = unknown> {
  private disposed = false;

  constructor(
    private value: T,
    private readonly evaluation: Evaluation
  ) {}

  valueForEvaluation(evaluation: Evaluation): T {
    if (this.evaluation !== evaluation)
      throw new Error(
        "JSHandles can be evaluated only in the context they were created!"
      );
    if (this.disposed) throw new Error("JSHandle is disposed!");
    return this.value;
  }

  async jsonValue(): Promise<T> {
    return this.evaluation.jsonValue(this.valueForEvaluation(this.evaluation));
  }

  async dispose(): Promise<void> {
    // Playwright invalidates the protocol handle even for primitive values.
    this.disposed = true;
    this.value = undefined as T;
  }
}
