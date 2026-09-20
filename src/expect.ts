/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type -- Playwright matcher plumbing uses open-ended receiver and matcher function types */
/**
 * Copyright Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0. See
 * LICENSES/PLAYWRIGHT-LICENSE.txt.
 */

import {
  any,
  anything,
  arrayContaining,
  arrayNotContaining,
  arrayOf,
  buildCustomAsymmetricMatcher,
  closeTo,
  createExpectedPromiseMessage,
  createExpectedToRejectMessage,
  createExpectedToResolveMessage,
  createThrowMatcher,
  getMessage,
  isPromise,
  matchers as genericMatchers,
  notArrayOf,
  notCloseTo,
  objectContaining,
  objectNotContaining,
  stringContaining,
  stringMatching,
  stringNotContaining,
  stringNotMatching,
  utils,
  validateMatcherResult,
  type MatcherContext,
  type MatchersObject,
  type RawMatcherFn,
  type SyncExpectationResult,
} from "./expectLibrary";
import type { Locator } from "@playwright/test";
import { isPlaywrightLiteLocator, type LocatorImpl } from "./locator";
import type { Page } from "@playwright/test";

interface AsymmetricMatcher {
  asymmetricMatch(other: unknown): boolean;
}

interface AsymmetricMatchers {
  any(expectedObject: unknown): AsymmetricMatcher;
  anything(): AsymmetricMatcher;
  arrayContaining(sample: unknown[]): AsymmetricMatcher;
  arrayOf(sample: unknown): AsymmetricMatcher;
  closeTo(expected: number, precision?: number): AsymmetricMatcher;
  objectContaining(sample: Record<string, unknown>): AsymmetricMatcher;
  stringContaining(expected: string): AsymmetricMatcher;
  stringMatching(expected: string | RegExp): AsymmetricMatcher;
}

interface GenericAssertions<R> {
  toBe(expected: unknown): R;
  toBeCloseTo(expected: number, precision?: number): R;
  toBeDefined(): R;
  toBeFalsy(): R;
  toBeGreaterThan(expected: number | bigint): R;
  toBeGreaterThanOrEqual(expected: number | bigint): R;
  toBeInstanceOf(expected: Function): R;
  toBeLessThan(expected: number | bigint): R;
  toBeLessThanOrEqual(expected: number | bigint): R;
  toBeNaN(): R;
  toBeNull(): R;
  toBeTruthy(): R;
  toBeUndefined(): R;
  toContain(expected: unknown): R;
  toContainEqual(expected: unknown): R;
  toEqual(expected: unknown): R;
  toHaveLength(expected: number): R;
  toHaveProperty(path: string | string[], value?: unknown): R;
  toMatch(expected: string | RegExp): R;
  toMatchObject(expected: Record<string, unknown> | unknown[]): R;
  toStrictEqual(expected: unknown): R;
  toThrow(expected?: unknown): R;
  toThrowError(expected?: unknown): R;
}

type LocatorAssertionOptions = {
  signal?: AbortSignal;
  timeout?: number;
};
type LocatorStateAssertionOptions = LocatorAssertionOptions & {
  attached?: boolean;
  checked?: boolean;
  editable?: boolean;
  enabled?: boolean;
  ignoreCase?: boolean;
  indeterminate?: boolean;
  ratio?: number;
  visible?: boolean;
};
type TextAssertionOptions = LocatorAssertionOptions & {
  ignoreCase?: boolean;
};
type AriaRole = Parameters<Locator["getByRole"]>[0];

/** The browser-safe subset of Playwright's LocatorAssertions. */
interface LocatorAssertions {
  toBeAttached(
    options?: LocatorAssertionOptions & { attached?: boolean }
  ): Promise<void>;
  toBeChecked(
    options?: LocatorAssertionOptions & {
      checked?: boolean;
      indeterminate?: boolean;
    }
  ): Promise<void>;
  toBeDisabled(options?: LocatorAssertionOptions): Promise<void>;
  toBeEditable(
    options?: LocatorAssertionOptions & { editable?: boolean }
  ): Promise<void>;
  toBeEmpty(options?: LocatorAssertionOptions): Promise<void>;
  toBeEnabled(
    options?: LocatorAssertionOptions & { enabled?: boolean }
  ): Promise<void>;
  toBeFocused(options?: LocatorAssertionOptions): Promise<void>;
  toBeHidden(options?: LocatorAssertionOptions): Promise<void>;
  toBeInViewport(
    options?: LocatorAssertionOptions & { ratio?: number }
  ): Promise<void>;
  toBeVisible(
    options?: LocatorAssertionOptions & { visible?: boolean }
  ): Promise<void>;
  toContainText(
    expected: string | RegExp | ReadonlyArray<string | RegExp>,
    options?: TextAssertionOptions & { useInnerText?: boolean }
  ): Promise<void>;
  toContainClass(
    expected: string | ReadonlyArray<string>,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveAccessibleDescription(
    expected: string | RegExp,
    options?: TextAssertionOptions
  ): Promise<void>;
  toHaveAccessibleName(
    expected: string | RegExp,
    options?: TextAssertionOptions
  ): Promise<void>;
  toHaveAccessibleErrorMessage(
    expected: string | RegExp,
    options?: TextAssertionOptions
  ): Promise<void>;
  toHaveAttribute(
    name: string,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveAttribute(
    name: string,
    expected: string | RegExp,
    options?: TextAssertionOptions
  ): Promise<void>;
  toHaveClass(
    expected: string | RegExp | ReadonlyArray<string | RegExp>,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveCount(
    expected: number,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveCSS(
    name: string,
    expected: string | RegExp,
    options?: LocatorAssertionOptions & { pseudo?: string }
  ): Promise<void>;
  toHaveId(
    expected: string | RegExp,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveJSProperty(
    name: string,
    expected: unknown,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveRole(
    expected: AriaRole,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveText(
    expected: string | RegExp | ReadonlyArray<string | RegExp>,
    options?: TextAssertionOptions & { useInnerText?: boolean }
  ): Promise<void>;
  toHaveValue(
    expected: string | RegExp,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toHaveValues(
    expected: ReadonlyArray<string | RegExp>,
    options?: LocatorAssertionOptions
  ): Promise<void>;
  toMatchAriaSnapshot(
    expected: string,
    options?: LocatorAssertionOptions
  ): Promise<void>;
}

type PageURLExpected = Parameters<Page["waitForURL"]>[0];

type PageAssertionOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

type PageURLAssertionOptions = PageAssertionOptions & {
  ignoreCase?: boolean;
};

interface PageAssertions {
  toHaveTitle(
    expected: string | RegExp,
    options?: PageAssertionOptions & { ignoreCase?: boolean }
  ): Promise<void>;
  toHaveURL(
    expected: PageURLExpected,
    options?: PageURLAssertionOptions
  ): Promise<void>;
}

interface ExpectMatcherUtils {
  matcherHint(
    matcherName: string,
    received?: unknown,
    expected?: unknown,
    options?: Record<string, unknown>
  ): string;
  printDiffOrStringify(
    expected: unknown,
    received: unknown,
    expectedLabel: string,
    receivedLabel: string,
    expand: boolean
  ): string;
  printExpected(value: unknown): string;
  printReceived(value: unknown): string;
  printWithType<T>(name: string, value: T, print: (value: T) => string): string;
  diff(a: unknown, b: unknown): string | null;
  stringify(value: unknown, maxDepth?: number, maxWidth?: number): string;
  EXPECTED_COLOR(value: string): string;
}

interface ExpectMatcherState {
  isNot: boolean;
  promise: "rejects" | "resolves" | "";
  timeout: number;
  utils: ExpectMatcherUtils;
}

interface MatcherResult {
  message: () => string;
  pass: boolean;
  name?: string;
  expected?: unknown;
  actual?: unknown;
  ariaSnapshot?: string;
  log?: string[];
  timeout?: number;
}

type ToUserMatcher<F, R> = F extends (
  received: any,
  ...args: infer A
) => infer M
  ? (...args: A) => M extends PromiseLike<unknown> ? Promise<void> : R
  : never;

type UserMatchers<E, R, T> = {
  [
    K in keyof E as E[K] extends (received: T, ...args: any[]) => any
      ? K
      : never
  ]: ToUserMatcher<E[K], R>;
};

type FunctionAssertions = {
  toPass(options?: { timeout?: number; intervals?: number[] }): Promise<void>;
};

type Matchers<R, T, ExtendedMatchers> = {
  not: Matchers<R, T, ExtendedMatchers>;
  resolves: Matchers<Promise<void>, Awaited<T>, ExtendedMatchers>;
  rejects: Matchers<Promise<void>, any, ExtendedMatchers>;
} & GenericAssertions<R> &
  (T extends Locator ? LocatorAssertions : Record<never, never>) &
  (T extends Page ? PageAssertions : Record<never, never>) &
  (T extends (...args: never[]) => unknown
    ? FunctionAssertions
    : Record<never, never>) &
  UserMatchers<ExtendedMatchers, R, T>;

type PollMatchers<T, ExtendedMatchers> = {
  not: PollMatchers<T, ExtendedMatchers>;
} & GenericAssertions<Promise<void>> &
  UserMatchers<ExtendedMatchers, Promise<void>, T>;

export type Expect<ExtendedMatchers = Record<never, never>> = {
  <T = unknown>(
    actual: T,
    messageOrOptions?: string | { message?: string }
  ): Matchers<void, T, ExtendedMatchers>;
  poll<T = unknown>(
    actual: () => T | Promise<T>,
    messageOrOptions?:
      string | { message?: string; timeout?: number; intervals?: number[] }
  ): PollMatchers<T, ExtendedMatchers>;
  extend<
    MoreMatchers extends Record<
      string,
      (
        this: ExpectMatcherState,
        received: any,
        ...args: any[]
      ) => MatcherResult | Promise<MatcherResult>
    >,
  >(
    matchers: MoreMatchers
  ): Expect<ExtendedMatchers & MoreMatchers>;
  configure(configuration: {
    message?: string;
    soft?: boolean;
    timeout?: number;
  }): Expect<ExtendedMatchers>;
  getState(): object;
  not: Omit<AsymmetricMatchers, "any" | "anything">;
} & AsymmetricMatchers;

type ExpectMessage = string | { message?: string };

type ExpectMetaInfo = {
  message?: string;
  isNot?: boolean;
  poll?: { timeout?: number; intervals?: number[] };
  timeout?: number;
  userMatchers: MatchersObject;
};

type InternalMatcherResult = SyncExpectationResult & {
  actual?: unknown;
  ariaSnapshot?: string;
  expected?: unknown;
  log?: string[];
  name?: string;
  timeout?: number;
};

type PageExpectationResult = {
  matches: boolean;
  received?: { value?: string };
  timeout?: number;
  timedOut?: boolean;
  invalid?: boolean;
  errorMessage?: string;
  log?: string[];
};

type PageExpectationTarget = {
  title(): Promise<string>;
  url(): string;
  _expect(
    expression: "to.have.title" | "to.have.url",
    options: {
      expected: string | RegExp | PageURLExpected;
      ignoreCase?: boolean;
      isNot?: boolean;
      signal?: AbortSignal;
      timeout?: number;
    }
  ): Promise<PageExpectationResult>;
};

const DEFAULT_EXPECT_TIMEOUT = 5_000;
const DEFAULT_INTERVALS = [100, 250, 500, 1_000];
const META_INFO = Symbol("expectMetaInfo");
const SOFT_UNSUPPORTED =
  "Soft assertions require Playwright Test's failure-reporting context and are not supported by playwright-lite.";

class ExpectationError extends Error {
  matcherResult: Omit<InternalMatcherResult, "message"> & { message: string };

  constructor(
    matcherName: string,
    result: InternalMatcherResult,
    customMessage: string
  ) {
    const matcherMessage = getMessage(result.message);
    super(
      customMessage ? `${customMessage}\n\n${matcherMessage}` : matcherMessage
    );
    this.matcherResult = {
      ...result,
      name: result.name ?? matcherName,
      message: matcherMessage,
    };
  }
}

function unsupportedMatcherEquality(): never {
  throw new Error(
    "It looks like you are using custom expect matchers that are not compatible with Playwright. See https://aka.ms/playwright/expect-compatibility"
  );
}

async function raceAgainstDeadline<T>(
  callback: () => Promise<T>,
  deadline: number
): Promise<{ result: T; timedOut: false } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    callback().then((result) => ({ result, timedOut: false }) as const),
    new Promise<{ timedOut: true }>((resolve) => {
      if (!deadline) return;
      timer = setTimeout(
        () => resolve({ timedOut: true }),
        Math.max(0, deadline - performance.now())
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function pollAgainstDeadline<T>(
  callback: () => Promise<{ continuePolling: boolean; result: T }>,
  deadline: number,
  intervals: number[] = DEFAULT_INTERVALS
): Promise<{ result?: T; timedOut: boolean }> {
  const remainingIntervals = [...intervals];
  const lastInterval = remainingIntervals.pop() ?? 1_000;
  let lastResult: T | undefined;
  while (true) {
    if (deadline && performance.now() >= deadline) break;
    const received = await raceAgainstDeadline(
      () => Promise.resolve().then(callback),
      deadline
    );
    if (received.timedOut) break;
    lastResult = received.result.result;
    if (!received.result.continuePolling)
      return { result: lastResult, timedOut: false };
    const interval = remainingIntervals.shift() ?? lastInterval;
    if (deadline && deadline <= performance.now() + interval) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return { result: lastResult, timedOut: true };
}

async function toPass(
  this: MatcherContext,
  callback: () => unknown,
  options: { intervals?: number[]; timeout?: number } = {}
): Promise<SyncExpectationResult> {
  const timeout = options.timeout ?? 0;
  const deadline = timeout ? performance.now() + timeout : 0;
  const timeoutMessage = `Timeout ${timeout}ms exceeded while waiting on the predicate`;
  const result = await pollAgainstDeadline<unknown>(
    async () => {
      try {
        await callback();
        return { continuePolling: !!this.isNot, result: undefined };
      } catch (error) {
        return { continuePolling: !this.isNot, result: error };
      }
    },
    deadline,
    options.intervals
  );

  if (result.timedOut) {
    const detail =
      result.result instanceof Error
        ? `${result.result.message}\n\nCall Log:\n- ${timeoutMessage}`
        : timeoutMessage;
    return { message: () => detail, pass: !!this.isNot };
  }
  return { message: () => "", pass: !this.isNot };
}

type LocatorExpectationReceiver = LocatorImpl;

type LocatorMatcherKind = "truthy" | "text" | "equal" | "aria";
type LocatorMatcherCall = {
  expression: string;
  expected: unknown;
  options?: Record<string, unknown>;
  kind: LocatorMatcherKind;
  expectation: string;
  matchSubstring?: boolean;
};

function isLocatorExpectationReceiver(
  value: unknown
): value is LocatorExpectationReceiver {
  return isPlaywrightLiteLocator(value);
}

function serializeExpectedTextValues(
  values: readonly (string | RegExp)[],
  options: {
    ignoreCase?: boolean;
    matchSubstring?: boolean;
    normalizeWhiteSpace?: boolean;
  } = {}
) {
  return values.map((value) => ({
    string: typeof value === "string" ? value : undefined,
    regexSource: value instanceof RegExp ? value.source : undefined,
    regexFlags: value instanceof RegExp ? value.flags : undefined,
    matchSubstring: options.matchSubstring,
    ignoreCase: options.ignoreCase,
    normalizeWhiteSpace: options.normalizeWhiteSpace,
  }));
}

function assertionOptions(value: unknown): LocatorStateAssertionOptions {
  return value && typeof value === "object"
    ? (value as LocatorStateAssertionOptions)
    : {};
}

function timingOptions(value: unknown): LocatorAssertionOptions {
  const { signal, timeout } = assertionOptions(value);
  return { signal, timeout };
}

function assertTextExpected(
  expected: unknown
): asserts expected is string | RegExp {
  if (
    typeof expected !== "string" &&
    !(expected && typeof (expected as { test?: unknown }).test === "function")
  )
    throw new Error(
      `Error: expected value must be a string or regular expression\n${utils.printWithType("Expected", expected, utils.printExpected)}`
    );
}

function dedentAriaSnapshot(snapshot: string): string {
  const lines = snapshot.split("\n");
  let whitespacePrefixLength = 100;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)/);
    if (match && match[1].length < whitespacePrefixLength)
      whitespacePrefixLength = match[1].length;
  }
  return lines
    .filter((line) => line.trim())
    .map((line) => line.substring(whitespacePrefixLength))
    .join("\n");
}

function locatorMatcher(
  matcherName: string,
  build: (args: unknown[]) => LocatorMatcherCall
): RawMatcherFn {
  return async function (
    this: MatcherContext,
    actual: unknown,
    ...args: unknown[]
  ): Promise<MatcherResult> {
    if (!isLocatorExpectationReceiver(actual)) {
      throw new Error(
        `${matcherName} can be used only with a playwright-lite Locator.`
      );
    }

    const call = build(args);
    const options = assertionOptions(call.options);
    const timeout =
      options.timeout ?? (this as MatcherContext & { timeout: number }).timeout;
    const result = await actual._expect(
      call.expression,
      {
        ...call.options,
        isNot: !!this.isNot,
        timeout,
        signal: options.signal,
      },
      matcherName
    );
    const pass = result.matches;
    if (pass === !this.isNot)
      return {
        name: matcherName,
        message: () => "",
        pass,
        expected: call.expected,
      };

    const received = result.received?.value;
    const printed = locatorFailureDetails(
      this.utils,
      call,
      received,
      pass,
      !!this.isNot,
      result.errorMessage
    );
    return {
      name: matcherName,
      expected: call.expected,
      actual:
        call.kind === "aria"
          ? (received as { raw?: string } | undefined)?.raw
          : received,
      ariaSnapshot: result.received?.ariaSnapshot,
      log: result.log,
      pass,
      timeout: result.timedOut ? timeout : undefined,
      message: () =>
        formatLocatorMatcherMessage(this.utils, {
          isNot: !!this.isNot,
          promise: this.promise ?? "",
          matcherName,
          expectation: call.expectation,
          locator: actual.toString(),
          timeout,
          timedOut: result.timedOut,
          errorMessage: result.errorMessage,
          log: result.log,
          ...printed,
        }),
    };
  };
}

function locatorFailureDetails(
  matcherUtils: ExpectMatcherUtils,
  call: LocatorMatcherCall,
  received: unknown,
  pass: boolean,
  isNot: boolean,
  errorMessage?: string
): Pick<
  LocatorMatcherMessage,
  "printedExpected" | "printedReceived" | "printedDiff"
> {
  if (call.kind === "truthy") {
    const expected = String(call.expected);
    return {
      printedExpected: `Expected: ${pass ? "not " : ""}${expected}`,
      printedReceived: errorMessage
        ? ""
        : `Received: ${pass ? expected : String(received)}`,
    };
  }

  if (call.kind === "aria") {
    const expected = call.expected as string;
    const receivedRaw = (received as { raw?: string } | undefined)?.raw ?? "";
    if (errorMessage)
      return {
        printedExpected: `Expected: ${isNot ? "not " : ""}${matcherUtils.printExpected(expected)}`,
      };
    if (pass)
      return {
        printedExpected: `Expected: not ${matcherUtils.printExpected(expected)}`,
        printedReceived: `Received: ${matcherUtils.printReceived(receivedRaw)}`,
      };
    return {
      printedDiff: matcherUtils.printDiffOrStringify(
        expected,
        receivedRaw,
        "Expected",
        "Received",
        false
      ),
    };
  }

  if (call.kind === "equal") {
    if (pass)
      return {
        printedExpected: `Expected: not ${matcherUtils.printExpected(call.expected)}`,
        printedReceived: errorMessage
          ? ""
          : `Received: ${matcherUtils.printReceived(received)}`,
      };
    if (errorMessage)
      return {
        printedExpected: `Expected: ${matcherUtils.printExpected(call.expected)}`,
      };
    return {
      printedDiff: matcherUtils.printDiffOrStringify(
        call.expected,
        received,
        "Expected",
        "Received",
        false
      ),
    };
  }

  const expected = call.expected as string | RegExp;
  const expectedSuffix =
    typeof expected === "string" && call.matchSubstring
      ? " substring"
      : typeof expected === "string"
        ? ""
        : " pattern";
  const receivedSuffix =
    typeof expected === "string" && call.matchSubstring
      ? " string"
      : typeof expected === "string"
        ? ""
        : " string";
  const receivedString = String(received ?? "");
  if (pass)
    return {
      printedExpected: `Expected${expectedSuffix}: not ${matcherUtils.printExpected(expected)}`,
      printedReceived: errorMessage
        ? ""
        : `Received${receivedSuffix}: ${matcherUtils.printReceived(receivedString)}`,
    };
  if (errorMessage)
    return {
      printedExpected: `Expected${expectedSuffix}: ${matcherUtils.printExpected(expected)}`,
    };
  return {
    printedDiff: matcherUtils.printDiffOrStringify(
      expected,
      receivedString,
      `Expected${expectedSuffix}`,
      `Received${receivedSuffix}`,
      false
    ),
  };
}

type LocatorMatcherMessage = {
  isNot: boolean;
  promise: string;
  matcherName: string;
  expectation: string;
  locator: string;
  timeout: number;
  timedOut?: boolean;
  printedExpected?: string;
  printedReceived?: string;
  printedDiff?: string | null;
  errorMessage?: string;
  log?: string[];
};

function formatLocatorMatcherMessage(
  matcherUtils: ExpectMatcherUtils,
  details: LocatorMatcherMessage
): string {
  let message = `expect(locator)${details.promise ? `.${details.promise}` : ""}${details.isNot ? ".not" : ""}.${details.matcherName}(${details.expectation}) failed\n\n`;
  const diffLines = details.printedDiff?.split("\n");
  if (diffLines?.length === 2) {
    details.printedExpected = diffLines[0];
    details.printedReceived = diffLines[1];
    details.printedDiff = undefined;
  }
  const align =
    !details.errorMessage &&
    details.printedExpected?.startsWith("Expected:") &&
    (!details.printedReceived ||
      details.printedReceived.startsWith("Received:"));
  message += `Locator: ${align ? " " : ""}${details.locator}\n`;
  if (details.printedExpected) message += `${details.printedExpected}\n`;
  if (details.printedReceived) message += `${details.printedReceived}\n`;
  if (details.timedOut)
    message += `Timeout: ${align ? " " : ""}${details.timeout}ms\n`;
  if (details.printedDiff) message += `${details.printedDiff}\n`;
  if (details.errorMessage)
    message += details.errorMessage.endsWith("\n")
      ? details.errorMessage
      : `${details.errorMessage}\n`;
  if (details.log?.some(Boolean))
    message += `\nCall log:\n${details.log
      .filter(Boolean)
      .map((line) => `  - ${line}`)
      .join("\n")}\n`;
  return message;
}

const locatorMatchers: MatchersObject = {
  toBeAttached: locatorMatcher("toBeAttached", ([options]) => {
    const attached = assertionOptions(options).attached ?? true;
    return {
      expression: attached ? "to.be.attached" : "to.be.detached",
      expected: attached ? "attached" : "detached",
      options: timingOptions(options),
      kind: "truthy",
      expectation: attached ? "" : "{ attached: false }",
    };
  }),
  toBeChecked: locatorMatcher("toBeChecked", ([options]) => {
    const value = assertionOptions(options) as LocatorAssertionOptions & {
      checked?: boolean;
      indeterminate?: boolean;
    };
    const expected = value.indeterminate
      ? "indeterminate"
      : value.checked === false
        ? "unchecked"
        : "checked";
    return {
      expression: "to.be.checked",
      expected,
      options: {
        expectedValue: {
          checked: value.checked,
          indeterminate: value.indeterminate,
        },
        ...timingOptions(value),
      },
      kind: "truthy",
      expectation: value.indeterminate
        ? "{ indeterminate: true }"
        : value.checked === false
          ? "{ checked: false }"
          : "",
    };
  }),
  toBeDisabled: locatorMatcher("toBeDisabled", ([options]) => ({
    expression: "to.be.disabled",
    expected: "disabled",
    options: timingOptions(options),
    kind: "truthy",
    expectation: "",
  })),
  toBeEditable: locatorMatcher("toBeEditable", ([options]) => {
    const editable = assertionOptions(options).editable ?? true;
    return {
      expression: editable ? "to.be.editable" : "to.be.readonly",
      expected: editable ? "editable" : "readOnly",
      options: timingOptions(options),
      kind: "truthy",
      expectation: editable ? "" : "{ editable: false }",
    };
  }),
  toBeEmpty: locatorMatcher("toBeEmpty", ([options]) => ({
    expression: "to.be.empty",
    expected: "empty",
    options: timingOptions(options),
    kind: "truthy",
    expectation: "",
  })),
  toBeEnabled: locatorMatcher("toBeEnabled", ([options]) => {
    const enabled = assertionOptions(options).enabled ?? true;
    return {
      expression: enabled ? "to.be.enabled" : "to.be.disabled",
      expected: enabled ? "enabled" : "disabled",
      options: timingOptions(options),
      kind: "truthy",
      expectation: enabled ? "" : "{ enabled: false }",
    };
  }),
  toBeFocused: locatorMatcher("toBeFocused", ([options]) => ({
    expression: "to.be.focused",
    expected: "focused",
    options: timingOptions(options),
    kind: "truthy",
    expectation: "",
  })),
  toBeHidden: locatorMatcher("toBeHidden", ([options]) => ({
    expression: "to.be.hidden",
    expected: "hidden",
    options: timingOptions(options),
    kind: "truthy",
    expectation: "",
  })),
  toBeInViewport: locatorMatcher("toBeInViewport", ([options]) => ({
    expression: "to.be.in.viewport",
    expected: "in viewport",
    options: {
      ...timingOptions(options),
      expectedNumber: assertionOptions(options).ratio,
    },
    kind: "truthy",
    expectation: "",
  })),
  toBeVisible: locatorMatcher("toBeVisible", ([options]) => {
    const visible = assertionOptions(options).visible ?? true;
    return {
      expression: visible ? "to.be.visible" : "to.be.hidden",
      expected: visible ? "visible" : "hidden",
      options: timingOptions(options),
      kind: "truthy",
      expectation: visible ? "" : "{ visible: false }",
    };
  }),
  toContainText: locatorMatcher("toContainText", ([expected, options]) => {
    if (!Array.isArray(expected)) assertTextExpected(expected);
    return Array.isArray(expected)
      ? {
          expression: "to.contain.text.array",
          expected,
          options: {
            ...timingOptions(options),
            useInnerText: (options as { useInnerText?: boolean } | undefined)
              ?.useInnerText,
            expectedText: serializeExpectedTextValues(
              expected as (string | RegExp)[],
              {
                matchSubstring: true,
                normalizeWhiteSpace: true,
                ignoreCase: assertionOptions(options).ignoreCase,
              }
            ),
          },
          kind: "equal",
          expectation: "expected",
        }
      : {
          expression: "to.have.text",
          expected,
          options: {
            ...timingOptions(options),
            useInnerText: (options as { useInnerText?: boolean } | undefined)
              ?.useInnerText,
            expectedText: serializeExpectedTextValues(
              [expected as string | RegExp],
              {
                matchSubstring: true,
                normalizeWhiteSpace: true,
                ignoreCase: assertionOptions(options).ignoreCase,
              }
            ),
          },
          kind: "text",
          expectation: "expected",
          matchSubstring: true,
        };
  }),
  toHaveAccessibleDescription: textMatcher("to.have.accessible.description", {
    ignoreCase: true,
    normalizeWhiteSpace: true,
  }),
  toHaveAccessibleName: textMatcher("to.have.accessible.name", {
    ignoreCase: true,
    normalizeWhiteSpace: true,
  }),
  toHaveAccessibleErrorMessage: textMatcher(
    "to.have.accessible.error.message",
    { ignoreCase: true, normalizeWhiteSpace: true }
  ),
  toHaveAttribute: locatorMatcher(
    "toHaveAttribute",
    ([name, expected, suppliedOptions]) => {
      const options =
        suppliedOptions ??
        (expected &&
        typeof expected === "object" &&
        !(expected instanceof RegExp)
          ? expected
          : undefined);
      if (expected === undefined || options === expected)
        return {
          expression: "to.have.attribute",
          expected: "have attribute",
          options: {
            ...timingOptions(options),
            expressionArg: name,
          },
          kind: "truthy",
          expectation: "",
        };
      assertTextExpected(expected);
      return {
        expression: "to.have.attribute.value",
        expected,
        options: {
          ...timingOptions(options),
          expressionArg: name,
          expectedText: serializeExpectedTextValues(
            [expected as string | RegExp],
            { ignoreCase: assertionOptions(options).ignoreCase }
          ),
        },
        kind: "text",
        expectation: "expected",
      };
    }
  ),
  toHaveClass: classMatcher(
    "toHaveClass",
    "to.have.class",
    "to.have.class.array"
  ),
  toContainClass: classMatcher(
    "toContainClass",
    "to.contain.class",
    "to.contain.class.array",
    true
  ),
  toHaveCount: locatorMatcher("toHaveCount", ([expected, options]) => ({
    expression: "to.have.count",
    expected,
    options: {
      ...timingOptions(options),
      expectedNumber: expected,
    },
    kind: "equal",
    expectation: "expected",
  })),
  toHaveCSS: locatorMatcher("toHaveCSS", ([name, expected, options]) => {
    assertTextExpected(expected);
    return {
      expression: "to.have.css",
      expected,
      options: {
        ...timingOptions(options),
        expressionArg: name,
        pseudo: (options as { pseudo?: string } | undefined)?.pseudo,
        expectedText: serializeExpectedTextValues([expected]),
      },
      kind: "text",
      expectation: "expected",
    };
  }),
  toHaveId: textMatcher("to.have.id"),
  toHaveJSProperty: locatorMatcher(
    "toHaveJSProperty",
    ([name, expected, options]) => ({
      expression: "to.have.property",
      expected,
      options: {
        ...timingOptions(options),
        expressionArg: name,
        expectedValue: expected,
      },
      kind: "equal",
      expectation: "expected",
    })
  ),
  toHaveRole: textMatcher("to.have.role", {}, (expected) => {
    if (typeof expected !== "string")
      throw new Error('"role" argument in toHaveRole must be a string');
  }),
  toHaveText: locatorMatcher("toHaveText", ([expected, options]) => {
    if (!Array.isArray(expected)) assertTextExpected(expected);
    return Array.isArray(expected)
      ? {
          expression: "to.have.text.array",
          expected,
          options: {
            ...timingOptions(options),
            useInnerText: (options as { useInnerText?: boolean } | undefined)
              ?.useInnerText,
            expectedText: serializeExpectedTextValues(
              expected as (string | RegExp)[],
              {
                normalizeWhiteSpace: true,
                ignoreCase: assertionOptions(options).ignoreCase,
              }
            ),
          },
          kind: "equal",
          expectation: "expected",
        }
      : {
          expression: "to.have.text",
          expected,
          options: {
            ...timingOptions(options),
            useInnerText: (options as { useInnerText?: boolean } | undefined)
              ?.useInnerText,
            expectedText: serializeExpectedTextValues(
              [expected as string | RegExp],
              {
                normalizeWhiteSpace: true,
                ignoreCase: assertionOptions(options).ignoreCase,
              }
            ),
          },
          kind: "text",
          expectation: "expected",
        };
  }),
  toHaveValue: textMatcher("to.have.value"),
  toHaveValues: locatorMatcher("toHaveValues", ([expected, options]) => ({
    expression: "to.have.values",
    expected,
    options: {
      ...timingOptions(options),
      expectedText: serializeExpectedTextValues(
        expected as (string | RegExp)[]
      ),
    },
    kind: "equal",
    expectation: "expected",
  })),
  toMatchAriaSnapshot: locatorMatcher(
    "toMatchAriaSnapshot",
    ([expected, options]) => {
      if (typeof expected !== "string")
        throw new Error(
          "toMatchAriaSnapshot accepts only an inline string in playwright-lite."
        );
      const snapshot = dedentAriaSnapshot(expected);
      return {
        expression: "to.match.aria",
        expected: snapshot,
        options: {
          ...timingOptions(options),
          expectedValue: snapshot,
        },
        kind: "aria",
        expectation: "expected",
      };
    }
  ),
};

function textMatcher(
  expression: string,
  settings: { ignoreCase?: boolean; normalizeWhiteSpace?: boolean } = {},
  validate?: (expected: unknown) => void
): RawMatcherFn {
  return locatorMatcher(
    expressionToMatcherName(expression),
    ([expected, options]) => {
      assertTextExpected(expected);
      validate?.(expected);
      return {
        expression,
        expected,
        options: {
          ...timingOptions(options),
          expectedText: serializeExpectedTextValues(
            [expected as string | RegExp],
            {
              ignoreCase: settings.ignoreCase
                ? assertionOptions(options).ignoreCase
                : undefined,
              normalizeWhiteSpace: settings.normalizeWhiteSpace,
            }
          ),
        },
        kind: "text",
        expectation: "expected",
      };
    }
  );
}

function classMatcher(
  matcherName: string,
  expression: string,
  arrayExpression: string,
  contains = false
): RawMatcherFn {
  return locatorMatcher(matcherName, ([expected, options]) => {
    if (
      contains &&
      (expected instanceof RegExp ||
        (Array.isArray(expected) &&
          expected.some((value) => value instanceof RegExp)))
    )
      throw new Error(
        `"expected" argument in ${matcherName} cannot${Array.isArray(expected) ? " contain" : " be"} a RegExp value`
      );
    if (!Array.isArray(expected)) assertTextExpected(expected);
    return Array.isArray(expected)
      ? {
          expression: arrayExpression,
          expected,
          options: {
            ...timingOptions(options),
            expectedText: serializeExpectedTextValues(
              expected as (string | RegExp)[]
            ),
          },
          kind: "equal",
          expectation: "expected",
        }
      : {
          expression,
          expected,
          options: {
            ...timingOptions(options),
            expectedText: serializeExpectedTextValues([
              expected as string | RegExp,
            ]),
          },
          kind: "text",
          expectation: "expected",
        };
  });
}

function expressionToMatcherName(expression: string): string {
  return (
    (
      {
        "to.have.accessible.description": "toHaveAccessibleDescription",
        "to.have.accessible.name": "toHaveAccessibleName",
        "to.have.accessible.error.message": "toHaveAccessibleErrorMessage",
        "to.have.id": "toHaveId",
        "to.have.role": "toHaveRole",
        "to.have.value": "toHaveValue",
      } as Record<string, string>
    )[expression] ?? expression
  );
}

function isPageExpectationTarget(
  value: unknown
): value is PageExpectationTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Partial<PageExpectationTarget>;
  return (
    typeof target.title === "function" &&
    typeof target.url === "function" &&
    typeof target._expect === "function"
  );
}

function isRegExp(value: unknown): value is RegExp {
  return (
    value instanceof RegExp ||
    Object.prototype.toString.call(value) === "[object RegExp]"
  );
}

function isURLPattern(value: unknown): boolean {
  const constructor = (
    globalThis as { URLPattern?: new (...args: unknown[]) => object }
  ).URLPattern;
  return typeof constructor === "function" && value instanceof constructor;
}

function pageMatcherMessage(
  context: MatcherContext,
  matcherName: "toHaveTitle" | "toHaveURL",
  expected: unknown,
  result: PageExpectationResult
): string {
  const isNot = !!context.isNot;
  let message = `expect(page)${isNot ? ".not" : ""}.${matcherName}(expected) failed\n\n`;
  if (result.invalid) {
    if (result.errorMessage) message += `${result.errorMessage}\n`;
    return message;
  }
  const received = result.received?.value;
  const isPredicate = typeof expected === "function" || isURLPattern(expected);
  const expectedSuffix = isRegExp(expected) ? " pattern" : "";
  const receivedSuffix = isRegExp(expected) ? " string" : "";
  if (isPredicate) {
    message += `Expected: predicate to ${isNot ? "fail" : "succeed"}\n`;
    if (received !== undefined)
      message += `Received: ${context.utils.printReceived(received)}\n`;
  } else if (isNot) {
    message += `Expected${expectedSuffix}: not ${context.utils.printExpected(expected)}\n`;
    if (received !== undefined)
      message += `Received${receivedSuffix}: ${context.utils.printReceived(received)}\n`;
  } else if (result.errorMessage) {
    message += `Expected${expectedSuffix}: ${context.utils.printExpected(expected)}\n`;
  } else if (received !== undefined) {
    message += context.utils.printDiffOrStringify(
      expected,
      received,
      `Expected${expectedSuffix}`,
      `Received${receivedSuffix}`,
      false
    );
    message += "\n";
  } else {
    message += `Expected: ${context.utils.printExpected(expected)}\n`;
  }
  if (result.timedOut) {
    const timeout =
      result.timeout ??
      (context as MatcherContext & { timeout: number }).timeout;
    const aligned = !result.errorMessage && !expectedSuffix && !receivedSuffix;
    message += `Timeout: ${aligned ? " " : ""}${timeout}ms\n`;
  }
  if (result.errorMessage) message += `${result.errorMessage}\n`;
  if (result.log?.length) message += `\nCall log:\n${result.log.join("\n")}\n`;
  return message;
}

function assertPageExpectationTarget(
  value: unknown,
  matcherName: "toHaveTitle" | "toHaveURL"
): asserts value is PageExpectationTarget {
  if (isPageExpectationTarget(value)) return;
  throw new Error(
    `${matcherName} can be only used with Page object, was called with ${String(value)}`
  );
}

async function toHaveTitle(
  this: MatcherContext,
  page: unknown,
  expected: string | RegExp,
  options: PageAssertionOptions & { ignoreCase?: boolean } = {}
): Promise<MatcherResult> {
  assertPageExpectationTarget(page, "toHaveTitle");
  if (typeof expected !== "string" && !isRegExp(expected))
    throw new Error(
      pageMatcherMessage(this, "toHaveTitle", expected, {
        matches: !!this.isNot,
        invalid: true,
        errorMessage:
          `Error: ${this.utils.EXPECTED_COLOR("expected")} value must be a string or regular expression\n` +
          this.utils.printWithType(
            "Expected",
            expected,
            this.utils.printExpected
          ),
      })
    );
  const result = await page._expect("to.have.title", {
    expected,
    ignoreCase: options.ignoreCase,
    isNot: !!this.isNot,
    signal: options.signal,
    timeout:
      options.timeout ?? (this as MatcherContext & { timeout: number }).timeout,
  });
  return {
    actual: result.received?.value,
    expected,
    message: () => pageMatcherMessage(this, "toHaveTitle", expected, result),
    name: "toHaveTitle",
    pass: result.matches,
  };
}

async function toHaveURL(
  this: MatcherContext,
  page: unknown,
  expected: PageURLExpected,
  options: PageURLAssertionOptions = {}
): Promise<MatcherResult> {
  assertPageExpectationTarget(page, "toHaveURL");
  if (
    typeof expected !== "string" &&
    !isRegExp(expected) &&
    !isURLPattern(expected) &&
    typeof expected !== "function"
  )
    throw new Error(
      pageMatcherMessage(this, "toHaveURL", expected, {
        matches: !!this.isNot,
        invalid: true,
        errorMessage:
          `Error: ${this.utils.EXPECTED_COLOR("expected")} value must be a string or regular expression\n` +
          this.utils.printWithType(
            "Expected",
            expected,
            this.utils.printExpected
          ),
      })
    );
  const result = await page._expect("to.have.url", {
    expected,
    ignoreCase: options.ignoreCase,
    isNot: !!this.isNot,
    signal: options.signal,
    timeout:
      options.timeout ?? (this as MatcherContext & { timeout: number }).timeout,
  });
  return {
    actual: result.received?.value,
    expected,
    message: () => pageMatcherMessage(this, "toHaveURL", expected, result),
    name: "toHaveURL",
    pass: result.matches,
  };
}

const pageMatchers: MatchersObject = { toHaveTitle, toHaveURL };

const allBuiltinMatchers: MatchersObject = {
  ...genericMatchers,
  toThrow: createThrowMatcher("toThrow"),
  toThrowError: createThrowMatcher("toThrowError"),
  toPass,
};

const promiseThrowMatchers: MatchersObject = {
  toThrow: createThrowMatcher("toThrow", true),
  toThrowError: createThrowMatcher("toThrowError", true),
};

function createExpect(info: ExpectMetaInfo): Expect<any> {
  const expectFunction = (actual: unknown, messageOrOptions?: ExpectMessage) =>
    createMatchers(actual, info, messageOrOptions);
  Object.defineProperty(expectFunction, META_INFO, { value: info });

  Object.assign(expectFunction, {
    any,
    anything,
    arrayContaining,
    arrayOf,
    closeTo,
    objectContaining,
    stringContaining,
    stringMatching,
  });

  const notAsymmetric = {
    arrayContaining: arrayNotContaining,
    arrayOf: notArrayOf,
    closeTo: notCloseTo,
    objectContaining: objectNotContaining,
    stringContaining: stringNotContaining,
    stringMatching: stringNotMatching,
  } as Record<string, unknown>;
  Object.defineProperty(expectFunction, "not", { value: notAsymmetric });

  for (const [name, matcher] of Object.entries(info.userMatchers)) {
    const { positive, inverse } = buildCustomAsymmetricMatcher(name, matcher);
    Object.defineProperty(expectFunction, name, {
      configurable: true,
      value: positive,
    });
    notAsymmetric[name] = inverse;
  }

  Object.defineProperty(expectFunction, "soft", {
    configurable: false,
    enumerable: false,
    get: () => {
      throw new Error(SOFT_UNSUPPORTED);
    },
  });

  expectFunction.getState = () => ({});
  expectFunction.configure = (configuration: {
    message?: string;
    timeout?: number;
    soft?: boolean;
  }) => {
    if (configuration.soft === true) throw new Error(SOFT_UNSUPPORTED);
    return createExpect({ ...info, ...configuration });
  };
  expectFunction.poll = (
    actual: unknown,
    messageOrOptions?:
      string | { message?: string; timeout?: number; intervals?: number[] }
  ) => {
    const poll =
      typeof messageOrOptions === "string" ? {} : (messageOrOptions ?? {});
    return createMatchers(
      actual,
      {
        ...info,
        poll: { timeout: poll.timeout, intervals: poll.intervals },
      },
      messageOrOptions
    );
  };
  expectFunction.extend = (matchers: MatchersObject) => {
    const accepted: MatchersObject = {};
    for (const [name, matcher] of Object.entries(matchers)) {
      if (typeof matcher !== "function")
        throw new TypeError(
          `expect.extend: \`${name}\` is not a valid matcher. Must be a function, is "${typeof matcher}"`
        );
    }
    for (const [name, matcher] of Object.entries(matchers)) {
      if (name in allBuiltinMatchers || name in pageMatchers) continue;
      accepted[name] = matcher;
      info.userMatchers[name] = matcher;
      const { positive, inverse } = buildCustomAsymmetricMatcher(name, matcher);
      Object.defineProperty(expectFunction, name, {
        configurable: true,
        value: positive,
      });
      notAsymmetric[name] = inverse;
    }
    return createExpect({
      ...info,
      userMatchers: { ...info.userMatchers, ...accepted },
    });
  };

  return expectFunction as Expect<any>;
}

function createMatchers(
  actual: unknown,
  originalInfo: ExpectMetaInfo,
  messageOrOptions?: ExpectMessage
) {
  const message =
    typeof messageOrOptions === "string"
      ? messageOrOptions
      : (messageOrOptions?.message ?? originalInfo.message);
  const info = { ...originalInfo, message };
  const notInfo = { ...info, isNot: !info.isNot };
  const result: Record<string, any> = {
    not: {},
    resolves: { not: {} },
    rejects: { not: {} },
  };
  const builtinMatchers = isPageExpectationTarget(actual)
    ? { ...allBuiltinMatchers, ...pageMatchers }
    : isLocatorExpectationReceiver(actual)
      ? { ...allBuiltinMatchers, ...locatorMatchers }
      : allBuiltinMatchers;
  const matchers = { ...builtinMatchers, ...info.userMatchers };
  for (const [name, matcher] of Object.entries({
    ...matchers,
  })) {
    result[name] = createMatcher(name, info, actual, matcher);
    result.not[name] = createMatcher(name, notInfo, actual, matcher);
    const promiseMatcher = promiseThrowMatchers[name] ?? matcher;
    result.resolves[name] = createMatcher(
      name,
      info,
      actual,
      promiseMatcher,
      "resolves"
    );
    result.resolves.not[name] = createMatcher(
      name,
      notInfo,
      actual,
      promiseMatcher,
      "resolves"
    );
    result.rejects[name] = createMatcher(
      name,
      info,
      actual,
      promiseMatcher,
      "rejects"
    );
    result.rejects.not[name] = createMatcher(
      name,
      notInfo,
      actual,
      promiseMatcher,
      "rejects"
    );
  }
  return result;
}

function createMatcher(
  matcherName: string,
  info: ExpectMetaInfo,
  actual: unknown,
  matcher: RawMatcherFn,
  promise?: "resolves" | "rejects"
) {
  return (...args: unknown[]) =>
    callMatcher(matcherName, info, actual, matcher, args, promise);
}

function callMatcher(
  matcherName: string,
  info: ExpectMetaInfo,
  actual: unknown,
  matcher: RawMatcherFn,
  args: unknown[],
  promise?: "resolves" | "rejects"
) {
  const finalize = (result: InternalMatcherResult) => {
    validateMatcherResult(result);
    if (result.pass === !!info.isNot)
      throw new ExpectationError(matcherName, result, info.message ?? "");
  };
  const invoke = () =>
    info.poll
      ? invokePollMatcher(matcherName, info, matcher, actual, args, promise)
      : invokeMatcher(info, matcherName, matcher, actual, args, promise);
  const result = invoke();
  if (isPromise<InternalMatcherResult>(result)) return result.then(finalize);
  finalize(result);
}

function invokeMatcher(
  info: ExpectMetaInfo,
  matcherName: string,
  matcher: RawMatcherFn,
  actual: unknown,
  args: unknown[],
  promise?: "resolves" | "rejects"
): InternalMatcherResult | Promise<InternalMatcherResult> {
  const context: MatcherContext & { timeout: number } = {
    customTesters: [],
    equals: unsupportedMatcherEquality,
    isNot: !!info.isNot,
    promise: promise ?? "",
    timeout: info.timeout ?? DEFAULT_EXPECT_TIMEOUT,
    utils,
  };
  if (!promise)
    return matcher.call(context, actual, ...args) as
      InternalMatcherResult | Promise<InternalMatcherResult>;

  if (typeof actual === "function") actual = actual();
  if (!isPromise(actual))
    return {
      pass: false,
      message: createExpectedPromiseMessage(
        matcherName,
        !!info.isNot,
        promise,
        actual
      ),
    };
  if (promise === "resolves") {
    return actual.then(
      (value) =>
        matcher.call(context, value, ...args) as
          InternalMatcherResult | Promise<InternalMatcherResult>,
      (error) => ({
        pass: false,
        message: createExpectedToResolveMessage(
          matcherName,
          !!info.isNot,
          promise,
          error
        ),
      })
    );
  }
  return actual.then(
    (value) => ({
      pass: false,
      message: createExpectedToRejectMessage(
        matcherName,
        !!info.isNot,
        promise,
        value
      ),
    }),
    (error) =>
      matcher.call(context, error, ...args) as
        InternalMatcherResult | Promise<InternalMatcherResult>
  );
}

async function invokePollMatcher(
  matcherName: string,
  info: ExpectMetaInfo,
  matcher: RawMatcherFn,
  actual: unknown,
  args: unknown[],
  promise?: "resolves" | "rejects"
): Promise<InternalMatcherResult> {
  if (typeof actual !== "function")
    throw new Error(
      "`expect.poll()` accepts only function as a first argument"
    );
  if (promise || matcherName === "toPass")
    throw new Error(
      `\`expect.poll()\` does not support "${promise ?? matcherName}" matcher.`
    );

  const timeout = info.poll?.timeout ?? info.timeout ?? DEFAULT_EXPECT_TIMEOUT;
  const deadline = timeout ? performance.now() + timeout : 0;
  const timeoutMessage = `Timeout ${timeout}ms exceeded while waiting on the predicate`;
  const result = await pollAgainstDeadline<Error | undefined>(
    async () => {
      const value = await actual();
      try {
        await callMatcher(
          matcherName,
          { ...info, poll: undefined },
          value,
          matcher,
          args
        );
        return { continuePolling: false, result: undefined };
      } catch (error) {
        return {
          continuePolling: true,
          result: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    deadline,
    info.poll?.intervals
  );
  if (result.timedOut) {
    const message = result.result
      ? `${result.result.message}\n\nCall Log:\n- ${timeoutMessage}`
      : timeoutMessage;
    return { pass: !!info.isNot, message: () => message };
  }
  return { pass: !info.isNot, message: () => "" };
}

export const expect: Expect = createExpect({ userMatchers: {} });
