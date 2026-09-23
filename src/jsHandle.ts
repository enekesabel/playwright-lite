/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright evaluation accepts arbitrary JavaScript values. */
import type { AdapterElementHandle } from "./elementHandle";
import type {
  Evaluation,
  EvaluationFunction,
  EvaluationOptions,
} from "./evaluation";

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

/**
 * A reference to one value in the controlled document.
 *
 * Mirrors pinned 26a9e47 client/jsHandle.ts and server/javascript.ts: the value
 * never leaves the document, and every member either evaluates against it or
 * copies it out through the pinned serializers.
 */
export class AdapterJSHandle<T = unknown> {
  protected readonly disposedError: string = "JSHandle is disposed!";
  private disposed = false;
  private preview: string | undefined;

  constructor(
    private value: T,
    protected readonly evaluation: Evaluation
  ) {}

  /** Internal boundary used by evaluation argument and target unwrapping. */
  valueForEvaluation(evaluation: Evaluation): T {
    if (this.evaluation !== evaluation)
      throw new Error(
        "JSHandles can be evaluated only in the context they were created!"
      );
    if (this.disposed) throw new Error(this.disposedError);
    return this.value;
  }

  asElement(): AdapterElementHandle | null {
    return null;
  }

  async evaluate<R>(
    pageFunction: EvaluationFunction<R>,
    arg?: unknown,
    options?: EvaluationOptions
  ): Promise<R> {
    assertMaxArguments(arguments.length, 3);
    assertEvaluationOptions(options);
    return this.evaluation.byValue(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      this
    );
  }

  async evaluateHandle(
    pageFunction: EvaluationFunction,
    arg?: unknown,
    options?: EvaluationOptions
  ): Promise<AdapterJSHandle> {
    assertMaxArguments(arguments.length, 3);
    assertEvaluationOptions(options);
    return this.evaluation.byHandle(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      this
    );
  }

  /** Pinned javascript.ts:188 reads the property off the value itself. */
  async getProperty(propertyName: string): Promise<AdapterJSHandle> {
    const value = this.valueForEvaluation(this.evaluation) as any;
    return this.evaluation.handleFor(value[propertyName]);
  }

  /**
   * Pinned crExecutionContext.ts:75 lists own enumerable data properties, and
   * javascript.ts:197 answers with an empty map for a value without an object.
   */
  async getProperties(): Promise<Map<string, AdapterJSHandle>> {
    const value = this.valueForEvaluation(this.evaluation);
    const properties = new Map<string, AdapterJSHandle>();
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function")
    )
      return properties;
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      properties.set(name, this.evaluation.handleFor(descriptor.value));
    }
    return properties;
  }

  async jsonValue(): Promise<T> {
    return this.evaluation.jsonValue(this.valueForEvaluation(this.evaluation));
  }

  async dispose(): Promise<void> {
    // The preview outlives the value, like the pinned client's preview string.
    this.toString();
    // Playwright invalidates the protocol handle even for primitive values.
    this.disposed = true;
    this.value = undefined as T;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  toString(): string {
    return (this.preview ??= this.computePreview());
  }

  protected computePreview(): string {
    return previewValue(this.value);
  }
}

/** Mirrors pinned crExecutionContext.ts `renderPreview` for a value with no remote object: `String(value)`, or a name for an object. Also used by `console.ts`'s argument previews. */
export function previewValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return String(value);
  if (typeof value !== "object")
    return Object.is(value, -0) ? "-0" : String(value);
  const tag = tagOf(value);
  if (tag === "Date" || tag === "RegExp") return String(value);
  if (tag === "Error") return (value as Error).stack || String(value);
  const name = tag === "Object" ? constructorName(value) : tag;
  if (tag === "Map" || tag === "Set")
    return `${name}(${(value as Map<unknown, unknown>).size})`;
  if (tag === "Array" || ArrayBuffer.isView(value))
    return `${name}(${(value as unknown[]).length})`;
  return name;
}

/**
 * V8 names an object without running page code, verified against real
 * Chromium: a `Symbol.toStringTag` or `constructor` accessor is never called.
 * These lookups read descriptors along the prototype chain instead; a Proxy's
 * traps still run, as nothing in the document can inspect one without them.
 */
export function tagOf(value: object): string {
  const descriptor = findDescriptor(value, Symbol.toStringTag);
  // `Object.prototype.toString` would call the accessor; V8 falls back to
  // the constructor name, which `previewValue` does for the "Object" tag.
  if (descriptor && !("value" in descriptor)) return "Object";
  return Object.prototype.toString.call(value).slice(8, -1);
}

function constructorName(value: object): string {
  const constructor = findDescriptor(value, "constructor")?.value;
  const name =
    typeof constructor === "function"
      ? findDescriptor(constructor, "name")?.value
      : undefined;
  return (typeof name === "string" && name) || "Object";
}

function findDescriptor(
  value: object,
  key: PropertyKey
): PropertyDescriptor | undefined {
  for (
    let owner: object | null = value;
    owner;
    owner = Object.getPrototypeOf(owner)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}
