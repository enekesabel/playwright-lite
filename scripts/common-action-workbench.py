from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


page = "src/page.ts"
locator = "src/locator.ts"

replace_once(page,
'''type ActionDeadline = { timeout: number; expiresAt: number };''',
'''type ActionDeadline = {
  timeout: number;
  expiresAt: number;
  signal?: AbortSignal;
};''')

replace_once(page,
'''type WaitForSelectorOptions = {
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};

type PageActionOptions = { timeout?: number };''',
'''type WaitForSelectorOptions = {
  signal?: AbortSignal;
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};

type PageActionOptions = { signal?: AbortSignal; timeout?: number };''')

replace_once(page,
'''type PageTypeOptions = PageStrictActionWithNoWaitAfterOptions & {
  delay?: number;
};''',
'''type PageTypeOptions = PageStrictActionWithNoWaitAfterOptions & {
  delay?: number;
};
type PagePressOptions = PageStrictActionWithNoWaitAfterOptions & {
  delay?: number;
};''')

replace_once(page,
'''  ): Promise<void> {
    try {
      while (true) {
        this.assertActionDeadline(deadline, action);''',
'''  ): Promise<void> {
    try {
      this.attachActionSignal(deadline, options.signal);
      while (true) {
        this.assertActionDeadline(deadline, action);''')

replace_once(page,
'''    deadline = this.createActionDeadline(timeout),
    strict = true
  ) {
    const { element } = await this.retryActionability(''',
'''    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ) {
    this.attachActionSignal(deadline, signal);
    const { element } = await this.retryActionability(''')

replace_once(page,
'''    deadline = this.createActionDeadline(timeout),
    strict = true
  ) {
    const element = await this.query(
      selector,
      label,
      { timeout },''',
'''    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal,
    delay?: number
  ) {
    this.attachActionSignal(deadline, signal);
    const element = await this.query(
      selector,
      label,
      { signal, timeout },''')

replace_once(page,
'''    this.focusElement(element);
    await this.keyboard.press(key, {}, deadline);''',
'''    this.focusElement(element);
    await this.keyboard.press(key, { delay }, deadline);''')

replace_once(page,
'''    deadline = this.createActionDeadline(timeout),
    strict = true
  ): Promise<string[]> {
    const normalized =''',
'''    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ): Promise<string[]> {
    this.attachActionSignal(deadline, signal);
    const normalized =''')

replace_once(page,
'''      await this.wait(Math.min(ACTION_RETRY_DELAY, remaining));''',
'''      await this.waitWithinActionDeadline(
        Math.min(ACTION_RETRY_DELAY, remaining),
        deadline,
        "select option"
      );''')

replace_once(page,
'''  async selectText(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<void> {
    const { element } =''',
'''  async selectText(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
    const { element } =''')

replace_once(page,
'''  async scrollLocatorIntoView(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<void> {
    const { element } =''',
'''  async scrollLocatorIntoView(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
    const { element } =''')

replace_once(page,
'''    options: {
      state: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    },''',
'''    options: {
      signal?: AbortSignal;
      state: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    },''')

replace_once(page,
'''        strict: true,
        timeout: options.timeout,
      });''',
'''        signal: options.signal,
        strict: true,
        timeout: options.timeout,
      });''')

replace_once(page,
'''    const payloads = inputFilePayloads(files);
    const deadline = this.createActionDeadline(options.timeout);
    await this.query(
      selector,
      selector,
      { timeout: options.timeout },''',
'''    const payloads = inputFilePayloads(files);
    const deadline = this.createActionDeadline(options.timeout);
    this.attachActionSignal(deadline, options.signal);
    await this.query(
      selector,
      selector,
      { signal: options.signal, timeout: options.timeout },''')

replace_once(page,
'''      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  async setInputFiles(''',
'''      options?.timeout,
      undefined,
      options?.strict === true,
      options?.signal
    );
  }

  async setInputFiles(''')

replace_once(page,
'''    options?: PageStrictActionWithNoWaitAfterOptions
  ): Promise<void> {
    assertPageActionOptions("press", options, ["noWaitAfter", "strict"]);''',
'''    options?: PagePressOptions
  ): Promise<void> {
    assertPageActionOptions("press", options, [
      "delay",
      "noWaitAfter",
      "strict",
    ]);''')

replace_once(page,
'''      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  async type(''',
'''      options?.timeout,
      undefined,
      options?.strict === true,
      options?.signal,
      options?.delay
    );
  }

  async type(''')

replace_once(page,
'''    const deadline = this.createActionDeadline(options?.timeout);
    await this.query(
      selector,
      label,
      { timeout: options?.timeout },''',
'''    const deadline = this.createActionDeadline(options?.timeout);
    this.attachActionSignal(deadline, options?.signal);
    await this.query(
      selector,
      label,
      { signal: options?.signal, timeout: options?.timeout },''')

replace_once(page,
'''      { timeout: options?.timeout },
      options?.strict === true
    );''',
'''      { signal: options?.signal, timeout: options?.timeout },
      options?.strict === true
    );''')

replace_once(page,
'''      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  async check(''',
'''      options?.timeout,
      undefined,
      options?.strict === true,
      options?.signal
    );
  }

  async check(''')

replace_once(page,
'''    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true
  ): Promise<void> {
    await this.query(
      selector,
      label,
      { timeout },''',
'''    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
    await this.query(
      selector,
      label,
      { signal, timeout },''')

replace_once(page,
'''      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  /**
   * Pinned 26a9e47 client/frame.ts''',
'''      options?.timeout,
      undefined,
      options?.strict === true,
      options?.signal
    );
  }

  /**
   * Pinned 26a9e47 client/frame.ts''')

replace_once(page,
'''  private createActionDeadline(timeout?: number): ActionDeadline {
    const effectiveTimeout = this.resolveTimeout(
      timeout,
      DEFAULT_ACTION_TIMEOUT
    );
    return {
      timeout: effectiveTimeout,
      expiresAt:
        effectiveTimeout === 0 ? Infinity : Date.now() + effectiveTimeout,
    };
  }

  private assertActionDeadline(''',
'''  private createActionDeadline(timeout?: number): ActionDeadline {
    const effectiveTimeout = this.resolveTimeout(
      timeout,
      DEFAULT_ACTION_TIMEOUT
    );
    return {
      timeout: effectiveTimeout,
      expiresAt:
        effectiveTimeout === 0 ? Infinity : Date.now() + effectiveTimeout,
    };
  }

  private attachActionSignal(
    deadline: ActionDeadline,
    signal: AbortSignal | undefined
  ) {
    deadline.signal = signal;
    if (signal?.aborted) throw actionAborted(signal, false);
  }

  private assertActionDeadline(''')

replace_once(page,
'''  ) {
    if (deadline && Date.now() >= deadline.expiresAt)
      throw new AdapterTimeoutError(''',
'''  ) {
    if (deadline?.signal?.aborted) throw actionAborted(deadline.signal, true);
    if (deadline && Date.now() >= deadline.expiresAt)
      throw new AdapterTimeoutError(''')

replace_once(page,
'''    const remaining = deadline ? deadline.expiresAt - Date.now() : durationMs;
    await this.wait(Math.min(durationMs, remaining));
    this.assertActionDeadline(deadline, actionName);''',
'''    const remaining = deadline ? deadline.expiresAt - Date.now() : durationMs;
    const completed = await waitForExpectationRetry(
      this.window,
      Math.min(durationMs, remaining),
      deadline?.signal
    );
    if (!completed && deadline?.signal)
      throw actionAborted(deadline.signal, true);
    this.assertActionDeadline(deadline, actionName);''')

replace_once(page,
'''    if (!deadline || deadline.expiresAt === Infinity) return operation;
    if (Date.now() >= deadline.expiresAt) throw timeoutError();

    let timeoutHandle: number | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        // Pinned stability checks wait for requestAnimationFrame. They only
        // inspect an element, so ending our await cannot cause a late input
        // action; the pinned primitive exposes no cancellation handle.
        timeoutHandle = this.window.setTimeout(
          () => reject(timeoutError()),
          Math.max(0, deadline.expiresAt - Date.now())
        );
        operation.then(resolve, reject);
      });
    } finally {
      if (timeoutHandle !== undefined) this.window.clearTimeout(timeoutHandle);
    }''',
'''    this.assertActionDeadline(deadline, "action");
    if (!deadline) return operation;

    let timeoutHandle: number | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        // Pinned stability checks wait for requestAnimationFrame. They only
        // inspect an element, so ending our await cannot cause a late input
        // action; the pinned primitive exposes no cancellation handle.
        if (deadline.expiresAt !== Infinity)
          timeoutHandle = this.window.setTimeout(
            () => reject(timeoutError()),
            Math.max(0, deadline.expiresAt - Date.now())
          );
        if (deadline.signal) {
          onAbort = () => reject(actionAborted(deadline.signal!, true));
          deadline.signal.addEventListener("abort", onAbort, { once: true });
        }
        operation.then(resolve, reject);
      });
    } finally {
      if (timeoutHandle !== undefined) this.window.clearTimeout(timeoutHandle);
      if (onAbort) deadline.signal?.removeEventListener("abort", onAbort);
    }''')

replace_once(page,
'''        if (remaining <= 0) throw timeoutError();
        await this.wait(Math.min(delay, remaining));''',
'''        if (remaining <= 0) throw timeoutError();
        await this.waitWithinActionDeadline(
          Math.min(delay, remaining),
          deadline,
          actionName
        );''')

replace_once(page,
'''  const unsupported = Object.keys(options).filter(
    (key) =>
      options[key] !== undefined &&
      key !== "timeout" &&
      !supported.includes(key)
  );''',
'''  const unsupported = Object.keys(options).filter(
    (key) =>
      options[key] !== undefined &&
      key !== "signal" &&
      key !== "timeout" &&
      !supported.includes(key)
  );''')

replace_once(page,
'''  if (options.timeout !== undefined)
    validateTimeout(options.timeout, `${method} timeout`);''',
'''  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError(`${method} signal must be an AbortSignal`);
  if (options.timeout !== undefined)
    validateTimeout(options.timeout, `${method} timeout`);''')

replace_once(page,
'''  const supported = [
    "noWaitAfter",''',
'''  const supported = [
    "signal",
    "noWaitAfter",''')

replace_once(page,
'''      key !== "state" &&
      key !== "timeout" &&''',
'''      key !== "signal" &&
      key !== "state" &&
      key !== "timeout" &&''')

replace_once(page,
'''  if (!allowsStrict && "strict" in options)
    throw new Error("ElementHandle waitForSelector does not support strict");''',
'''  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError("waitForSelector signal must be an AbortSignal");
  if (!allowsStrict && "strict" in options)
    throw new Error("ElementHandle waitForSelector does not support strict");''')

replace_once(page,
'''function queryAborted(signal: AbortSignal): Error {
  return new Error(`Query was aborted: ${abortReason(signal)}`);
}
''',
'''function actionAborted(signal: AbortSignal, inFlight: boolean): Error {
  const reason = abortReason(signal);
  const error = new Error(
    inFlight
      ? `${reason}\\nCall log:\\n  - operation was aborted: ${reason}`
      : "The operation was aborted",
    { cause: signal.reason }
  );
  error.name = "AbortError";
  return error;
}

function queryAborted(signal: AbortSignal): Error {
  return new Error(`Query was aborted: ${abortReason(signal)}`);
}
''')

# Locator option plumbing.
replace_once(locator,
'''type LocatorActionOptions = { timeout?: number };''',
'''type LocatorActionOptions = { signal?: AbortSignal; timeout?: number };''')

replace_once(locator,
'''  async press(key: string, options?: LocatorActionWithNoWaitAfterOptions) {
    rejectUnsupportedOptions("press", options, ["noWaitAfter", "timeout"]);''',
'''  async press(key: string, options?: LocatorTypeOptions) {
    rejectUnsupportedOptions("press", options, [
      "delay",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async focus(''',
'''      this.label,
      options?.timeout,
      undefined,
      true,
      options?.signal,
      options?.delay
    );
  }

  async focus(''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async setInputFiles(''',
'''      this.label,
      options?.timeout,
      undefined,
      true,
      options?.signal
    );
  }

  async setInputFiles(''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async hover(''',
'''      this.label,
      options?.timeout,
      undefined,
      true,
      options?.signal
    );
  }

  async hover(''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async selectText(''',
'''      this.label,
      options?.timeout,
      undefined,
      true,
      options?.signal
    );
  }

  async selectText(''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async scrollIntoViewIfNeeded(''',
'''      this.label,
      options?.timeout,
      undefined,
      options?.signal
    );
  }

  async scrollIntoViewIfNeeded(''')

replace_once(locator,
'''      this.label,
      options?.timeout
    );
  }

  async type(''',
'''      this.label,
      options?.timeout,
      undefined,
      options?.signal
    );
  }

  async type(''')

replace_once(locator,
'''      "delay",
      "noWaitAfter",
      "timeout",''',
'''      "delay",
      "noWaitAfter",
      "signal",
      "timeout",''')

replace_once(locator,
'''    options: {
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    } = {}''',
'''    options: {
      signal?: AbortSignal;
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    } = {}''')

replace_once(locator,
'''    rejectUnsupportedOptions("waitFor", options, ["state", "timeout"]);''',
'''    rejectUnsupportedOptions("waitFor", options, ["signal", "state", "timeout"]);''')

replace_once(locator,
'''      { state, timeout: options.timeout },''',
'''      { signal: options.signal, state, timeout: options.timeout },''')

# Every Locator action using this helper may accept signal once its option type does.
replace_once(locator,
'''  if (supported.includes("noWaitAfter"))
    validateNoWaitAfter(method, options.noWaitAfter);''',
'''  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError(`${method} signal must be an AbortSignal`);
  if (supported.includes("noWaitAfter"))
    validateNoWaitAfter(method, options.noWaitAfter);''')

print("common action source transformations applied")
