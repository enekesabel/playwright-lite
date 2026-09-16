from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


locator = "src/locator.ts"
page = "src/page.ts"
contract = "src/contract.test.ts"

# Complete signal option validation on common Locator action paths.
replace(
    locator,
    'rejectUnsupportedOptions("fill", options, ["noWaitAfter", "timeout"]);',
    'rejectUnsupportedOptions("fill", options, ["noWaitAfter", "signal", "timeout"]);',
)
replace(
    locator,
    '''rejectUnsupportedOptions("setInputFiles", options, [
      "noWaitAfter",
      "timeout",
    ]);''',
    '''rejectUnsupportedOptions("setInputFiles", options, [
      "noWaitAfter",
      "signal",
      "timeout",
    ]);''',
)
replace(
    locator,
    'rejectUnsupportedOptions("clear", options, ["noWaitAfter", "timeout"]);',
    'rejectUnsupportedOptions("clear", options, ["noWaitAfter", "signal", "timeout"]);',
)
replace(
    locator,
    '''rejectUnsupportedOptions("selectOption", options, [
      "noWaitAfter",
      "timeout",
    ]);''',
    '''rejectUnsupportedOptions("selectOption", options, [
      "noWaitAfter",
      "signal",
      "timeout",
    ]);''',
)
for method in ("selectText", "scrollIntoViewIfNeeded"):
    replace(
        locator,
        f'rejectUnsupportedOptions("{method}", options, ["timeout"]);',
        f'rejectUnsupportedOptions("{method}", options, ["signal", "timeout"]);',
    )
replace(
    locator,
    'rejectUnsupportedOptions("dispatchEvent", options, ["timeout"]);',
    'rejectUnsupportedOptions("dispatchEvent", options, ["signal", "timeout"]);',
)
replace(
    locator,
    '''      this.label,
      options?.timeout
    );
  }

  async selectOption(''',
    '''      this.label,
      options?.timeout,
      undefined,
      true,
      options?.signal
    );
  }

  async selectOption(''',
)
replace(
    page,
    '''      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  async dispatchEventSelector(''',
    '''      options?.timeout,
      undefined,
      options?.strict === true,
      options?.signal
    );
  }

  async dispatchEventSelector(''',
)

# Preserve the richer caller-owned timeout diagnostics. The shared wait helper
# may notice that the deadline elapsed while sleeping, but retryActionability
# owns lastError/call-log context and must remain the one that formats timeout.
replace(
    page,
    '''        await this.waitWithinActionDeadline(
          Math.min(delay, remaining),
          deadline,
          actionName
        );''',
    '''        try {
          await this.waitWithinActionDeadline(
            Math.min(delay, remaining),
            deadline,
            actionName
          );
        } catch (error) {
          if (error instanceof AdapterTimeoutError) throw timeoutError();
          throw error;
        }''',
)
replace(
    page,
    '''      await this.waitWithinActionDeadline(
        Math.min(ACTION_RETRY_DELAY, remaining),
        deadline,
        "select option"
      );''',
    '''      try {
        await this.waitWithinActionDeadline(
          Math.min(ACTION_RETRY_DELAY, remaining),
          deadline,
          "select option"
        );
      } catch (error) {
        if (error instanceof AdapterTimeoutError)
          throw new AdapterTimeoutError(
            `select option: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
            { cause: lastError }
          );
        throw error;
      }''',
)

# Contract tests previously asserted that signal/delay were unsupported. They
# now validate the supported option surface while retaining bad-value guards.
replace(
    contract,
    '''    it("click rejects unsupported options", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      await expect(
        page.locator("button").click({ signal: true } as any)
      ).rejects.toThrow(/unsupported Playwright option.*signal/);
    });''',
    '''    it("click validates the signal option", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      await expect(
        page.locator("button").click({ signal: true } as any)
      ).rejects.toThrow(/click signal must be an AbortSignal/);
    });''',
)
replace(
    contract,
    '''    it("rejects defined unsupported option values, including false and null", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      for (const signal of [false, null]) {
        await expect(
          page.locator("button").click({ signal } as any)
        ).rejects.toThrow(/unsupported Playwright option.*signal/);
      }
    });''',
    '''    it("rejects invalid signal values, including false and null", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      for (const signal of [false, null]) {
        await expect(
          page.locator("button").click({ signal } as any)
        ).rejects.toThrow(/click signal must be an AbortSignal/);
      }
    });''',
)
replace(
    contract,
    '''    it("press rejects unsupported options", async () => {
      document.body.innerHTML = '<input type="text" />';
      const page = createPage();
      await expect(
        page.locator("input").press("a", { delay: 100 } as any)
      ).rejects.toThrow(/unsupported Playwright option.*delay/);
    });''',
    '''    it("press accepts the delay option", async () => {
      document.body.innerHTML = '<input type="text" />';
      const page = createPage();
      await page.locator("input").press("a", { delay: 1 });
      expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("a");
    });''',
)
replace(
    contract,
    '''      await expect(
        page.locator("#button").dblclick({ signal: true } as any)
      ).rejects.toThrow("unsupported Playwright option(s): signal");''',
    '''      await expect(
        page.locator("#button").dblclick({ signal: true } as any)
      ).rejects.toThrow("dblclick signal must be an AbortSignal");''',
)
replace(
    contract,
    '''    it("rejects action options whose semantics are not implemented", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();

      await expect(
        page.locator("#input").check({ signal: new AbortController().signal })
      ).rejects.toThrow(/unsupported Playwright option/);
      await expect(
        page
          .locator("#input")
          .pressSequentially("a", { delay: 1, force: true } as any)
      ).rejects.toThrow(/unsupported Playwright option/);
    });''',
    '''    it("rejects invalid or unsupported action options", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();

      await expect(
        page.locator("#input").check({ signal: true } as any)
      ).rejects.toThrow(/check signal must be an AbortSignal/);
      await expect(
        page
          .locator("#input")
          .pressSequentially("a", { delay: 1, force: true } as any)
      ).rejects.toThrow(/unsupported Playwright option/);
    });''',
)

print("common action signal call-site and regression fixups applied")
