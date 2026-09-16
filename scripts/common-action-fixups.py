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

print("common action signal call-site fixups applied")
