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
  expected?: unknown;
  name?: string;
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
    for (const [name, matcher] of Object.entries(matchers)) {
      if (typeof matcher !== "function")
        throw new TypeError(
          `expect.extend: \`${name}\` is not a valid matcher. Must be a function, is "${typeof matcher}"`
        );
    }
    for (const [name, matcher] of Object.entries(matchers)) {
      if (name in allBuiltinMatchers) continue;
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
      userMatchers: { ...info.userMatchers, ...matchers },
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
  for (const [name, matcher] of Object.entries({
    ...allBuiltinMatchers,
    ...info.userMatchers,
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
