import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReport,
  compareBaseline,
  validateCompleteness,
  validateReportErrors,
  reviewedPromotion,
  failurePhase,
} from "./upstream-baseline.mjs";

// ── parseReport ─────────────────────────────────────────────────────

it("reports observed failure phases without claiming subject execution", () => {
  assert.equal(
    failurePhase({ status: "failed", error: "Cannot serialize function" }),
    "argument transport"
  );
  assert.equal(
    failurePhase({
      status: "failed",
      error: "Passed function is not well-serializable!",
    }),
    "callback reconstruction"
  );
  assert.equal(
    failurePhase({
      status: "failed",
      error: "Unexpected serialization failure",
    }),
    "serialization failure"
  );
  assert.equal(
    failurePhase({ status: "failed", error: "goto is not a function" }),
    "missing member or reference"
  );
  assert.equal(
    failurePhase({
      status: "failed",
      error: "toHaveText can be only used with Locator object",
    }),
    "matcher integration"
  );
  assert.equal(
    failurePhase({
      status: "failed",
      error: "expect(received).toBe(expected)",
    }),
    "assertion"
  );
  assert.equal(failurePhase({ status: "timedOut" }), "timeout");
  assert.equal(
    failurePhase({
      status: "failed",
      execution: { entered: ["Page.setContent"] },
    }),
    "after adapter entry"
  );
  assert.equal(failurePhase({ status: "failed" }), "before adapter entry");
});

describe("reviewed promotion", () => {
  it("treats a raw pass without the reviewed operation as a regression", () => {
    const baseline = {
      reviewed: [
        { id: "test", method: "Locator.click", evidence: "click changes DOM" },
      ],
    };
    for (const execution of [
      null,
      { entered: ["Page.setContent"], failures: [] },
      { entered: ["Locator.click"], failures: ["serialization failed"] },
    ]) {
      const result = compareBaseline(
        [{ id: "test", file: "test.ts", status: "passed", execution }],
        baseline,
        ["test.ts"]
      );
      assert.deepEqual(result.regressions, ["test"]);
    }
  });
  it("rejects reviewed out-of-scope or native target methods", () => {
    const outOfScope = compareBaseline(
      [
        {
          id: "test",
          file: "test.ts",
          status: "passed",
          execution: { entered: ["Page.setContent"], failures: [] },
        },
      ],
      {
        reviewed: [
          { id: "test", method: "Page.setContent", evidence: "old review" },
        ],
      },
      ["test.ts"]
    );
    assert.deepEqual(outOfScope.regressions, ["test"]);

    const nativeTarget = compareBaseline(
      [
        {
          id: "test",
          file: "test.ts",
          status: "passed",
          execution: {
            entered: ["Locator.click"],
            native: ["Locator.click"],
            failures: [],
          },
        },
      ],
      {
        reviewed: [
          { id: "test", method: "Locator.click", evidence: "old review" },
        ],
      },
      ["test.ts"]
    );
    assert.deepEqual(nativeTarget.regressions, ["test"]);
  });
  it("allows mixed native setup with a distinct browser-reviewed operation", () => {
    const result = compareBaseline(
      [
        {
          id: "test",
          file: "test.ts",
          status: "passed",
          execution: {
            entered: ["Locator.click"],
            native: ["Page.setContent"],
            failures: [],
          },
        },
      ],
      {
        reviewed: [
          {
            id: "test",
            method: "Locator.click",
            evidence: "click changes DOM",
          },
        ],
      },
      ["test.ts"]
    );
    assert.deepEqual(result.regressions, []);
  });
  const entry = {
    id: "test",
    status: "passed",
    execution: { entered: ["Page.evaluate"], failures: [] },
  };
  it("requires execution of the reviewed method", () => {
    assert.throws(() =>
      reviewedPromotion([entry], "test", "Page.goto", "checks navigation")
    );
  });
  it("rejects swallowed transport failures and missing evidence", () => {
    assert.throws(() =>
      reviewedPromotion(
        [
          {
            ...entry,
            execution: { ...entry.execution, failures: ["not a function"] },
          },
        ],
        "test",
        "Page.evaluate",
        "checks value"
      )
    );
    assert.throws(() =>
      reviewedPromotion([entry], "test", "Page.evaluate", "")
    );
  });
  it("allows native setup but rejects native out-of-scope promotion", () => {
    assert.deepEqual(
      reviewedPromotion(
        [
          {
            ...entry,
            execution: { ...entry.execution, native: ["Page.setContent"] },
          },
        ],
        "test",
        "Page.evaluate",
        "native setup may support a separate browser-routed operation"
      ),
      {
        id: "test",
        method: "Page.evaluate",
        evidence:
          "native setup may support a separate browser-routed operation",
      }
    );
    assert.throws(() =>
      reviewedPromotion(
        [
          {
            ...entry,
            execution: { entered: ["Page.setContent"], failures: [] },
          },
        ],
        "test",
        "Page.setContent",
        "native setup cannot certify browser compatibility"
      )
    );
  });
  it("records the reviewed assertion", () => {
    assert.deepEqual(
      reviewedPromotion(
        [entry],
        "test",
        "Page.evaluate",
        "checks returned value"
      ),
      { id: "test", method: "Page.evaluate", evidence: "checks returned value" }
    );
  });
});

describe("parseReport", () => {
  it("extracts flat test entries with stable IDs", () => {
    const report = {
      suites: [
        {
          title: "",
          file: "tests/upstream/locator-click.spec.ts",
          suites: [],
          specs: [
            {
              title: "should click button",
              file: "tests/upstream/locator-click.spec.ts",
              tests: [
                {
                  annotations: [
                    {
                      type: "adapter-execution",
                      description: JSON.stringify({
                        entered: ["Locator.click"],
                        failures: [],
                      }),
                    },
                  ],
                  results: [{ status: "passed" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const entries = parseReport(report);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, "locator-click.spec.ts > should click button");
    assert.equal(entries[0].status, "passed");
    assert.equal(entries[0].file, "locator-click.spec.ts");
    assert.deepEqual(entries[0].execution, {
      entered: ["Locator.click"],
      failures: [],
    });
  });

  it("handles nested suites in title path", () => {
    const report = {
      suites: [
        {
          title: "",
          file: "tests/upstream/foo.spec.ts",
          suites: [
            {
              title: "describe block",
              suites: [],
              specs: [
                {
                  title: "nested test",
                  file: "tests/upstream/foo.spec.ts",
                  tests: [{ annotations: [], results: [{ status: "failed" }] }],
                },
              ],
            },
          ],
          specs: [],
        },
      ],
    };

    const entries = parseReport(report);
    assert.equal(entries[0].id, "foo.spec.ts > describe block > nested test");
  });
});

// ── validateReportErrors ─────────────────────────────────────────────

describe("validateReportErrors", () => {
  it("returns empty array for report with no errors", () => {
    assert.deepEqual(validateReportErrors({ suites: [], errors: [] }), []);
  });

  it("returns empty array when errors key is missing", () => {
    assert.deepEqual(validateReportErrors({ suites: [] }), []);
  });

  it("rejects report with collection errors", () => {
    const report = {
      suites: [],
      errors: [
        {
          message:
            "Error: Cannot find module '/some/path/coreBundle'\nmore stack",
        },
      ],
    };
    const errs = validateReportErrors(report);
    assert.equal(errs.length, 1);
    assert.ok(errs[0].includes("Cannot find module"));
  });

  it("rejects report with multiple errors", () => {
    const report = {
      suites: [],
      errors: [{ message: "Error: first" }, { message: "Error: second" }],
    };
    assert.equal(validateReportErrors(report).length, 2);
  });
});

// ── validateCompleteness ────────────────────────────────────────────

describe("validateCompleteness", () => {
  const makeEntry = (file, title, status = "failed") => ({
    id: `${file} > ${title}`,
    status,
    file,
  });

  it("passes when all corpus specs are present", () => {
    const entries = [
      makeEntry("locator-click.spec.ts", "test a"),
      makeEntry("retarget.spec.ts", "test b"),
    ];
    const names = ["locator-click.spec.ts", "retarget.spec.ts"];
    const { errors, specCount, testCount } = validateCompleteness(
      entries,
      names
    );
    assert.equal(errors.length, 0);
    assert.equal(specCount, 2);
    assert.equal(testCount, 2);
  });

  it("reports missing corpus specs", () => {
    const entries = [makeEntry("locator-click.spec.ts", "test a")];
    const names = ["locator-click.spec.ts", "retarget.spec.ts"];
    const { errors } = validateCompleteness(entries, names);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("retarget.spec.ts"));
  });

  it("reports duplicate stable IDs", () => {
    const entries = [
      makeEntry("locator-click.spec.ts", "test a"),
      makeEntry("locator-click.spec.ts", "test a"),
    ];
    const names = ["locator-click.spec.ts"];
    const { errors } = validateCompleteness(entries, names);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("Duplicate"));
  });
});

// ── compareBaseline ─────────────────────────────────────────────────

describe("compareBaseline", () => {
  const makeEntry = (id, status) => ({
    id,
    status,
    file: id.split(" > ")[0],
    execution: { entered: ["Locator.click"], failures: [] },
  });

  const names = ["locator-click.spec.ts", "page-goto.spec.ts"];

  it("detects regressions when a baseline test now fails", () => {
    const entries = [
      makeEntry("locator-click.spec.ts > should click", "failed"),
      makeEntry("locator-click.spec.ts > should fill", "passed"),
    ];
    const baseline = {
      reviewed: [
        "locator-click.spec.ts > should click",
        "locator-click.spec.ts > should fill",
      ].map((id) => ({ id, method: "Locator.click" })),
    };
    const result = compareBaseline(entries, baseline, names);
    assert.deepEqual(result.regressions, [
      "locator-click.spec.ts > should click",
    ]);
  });

  it("detects regressions when a baseline test disappears", () => {
    const entries = [
      makeEntry("locator-click.spec.ts > should fill", "passed"),
    ];
    const baseline = {
      reviewed: [
        "locator-click.spec.ts > should click",
        "locator-click.spec.ts > should fill",
      ].map((id) => ({ id, method: "Locator.click" })),
    };
    const result = compareBaseline(entries, baseline, names);
    assert.deepEqual(result.regressions, [
      "locator-click.spec.ts > should click",
    ]);
  });

  it("surfaces newly passing tests", () => {
    const entries = [
      makeEntry("locator-click.spec.ts > should click", "passed"),
      makeEntry("locator-click.spec.ts > new test", "passed"),
    ];
    const baseline = {
      reviewed: [
        { id: "locator-click.spec.ts > should click", method: "Locator.click" },
      ],
    };
    const result = compareBaseline(entries, baseline, names);
    assert.deepEqual(result.regressions, []);
    assert.deepEqual(result.newlyPassing, ["locator-click.spec.ts > new test"]);
  });

  it("separates skipped from failed", () => {
    const entries = [
      makeEntry("locator-click.spec.ts > a", "failed"),
      makeEntry("locator-click.spec.ts > b", "skipped"),
      makeEntry("locator-click.spec.ts > c", "passed"),
    ];
    const baseline = { reviewed: [] };
    const result = compareBaseline(entries, baseline, names);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.currentPassing.length, 1);
  });

  it("reconciles to total", () => {
    const entries = [
      makeEntry("locator-click.spec.ts > a", "passed"),
      makeEntry("locator-click.spec.ts > b", "failed"),
      makeEntry("locator-click.spec.ts > c", "skipped"),
      makeEntry("page-goto.spec.ts > d", "passed"),
    ];
    const baseline = { reviewed: [] };
    const result = compareBaseline(entries, baseline, names);
    const reconciled =
      result.currentPassing.length + result.failed + result.skipped;
    assert.equal(reconciled, result.total);
  });
});
