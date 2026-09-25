import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReport,
  compareBaseline,
  validateCompleteness,
  reportErrorMessages,
  reviewedPromotion,
  blockingRegressions,
  parsePromotionArgs,
  failurePhase,
  sabotageVerdict,
  sabotageGrep,
  sabotageRerunEntries,
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
  describe("sabotage rerun", () => {
    const id = "locator-click.spec.ts > should click";
    it("refuses a test that still passes without the reviewed method", () => {
      assert.throws(
        () =>
          sabotageVerdict(
            [
              {
                id,
                status: "passed",
                execution: { entered: [], failures: [] },
              },
            ],
            id,
            "Locator.click"
          ),
        /still passes.*Locator\.click/s
      );
    });
    it("refuses when the rerun skipped the test", () => {
      assert.throws(
        () => sabotageVerdict([{ id, status: "skipped" }], id, "Locator.click"),
        /skipped/
      );
    });
    it("refuses when the rerun did not run the test", () => {
      assert.throws(
        () => sabotageVerdict([], id, "Locator.click"),
        /did not run/
      );
    });
    it("requires the asserted failure reason when provided", () => {
      assert.throws(
        () =>
          sabotageVerdict(
            [{ id, status: "failed", error: "some unrelated failure" }],
            id,
            "Locator.toHaveText",
            "__pwLiteSabotagedMatcher: Locator.toHaveText"
          ),
        /not for the expected reason/
      );
      assert.doesNotThrow(() =>
        sabotageVerdict(
          [
            {
              id,
              status: "failed",
              error:
                "Error: __pwLiteSabotagedMatcher: Locator.toHaveText was withheld for promotion review.",
            },
          ],
          id,
          "Locator.toHaveText",
          "__pwLiteSabotagedMatcher: Locator.toHaveText"
        )
      );
    });
    it("accepts a test that fails once the method is sabotaged", () => {
      assert.doesNotThrow(() =>
        sabotageVerdict(
          [{ id, status: "failed", error: "Locator.click is sabotaged" }],
          id,
          "Locator.click"
        )
      );
    });
    // A test's unawaited call can settle after the test ended, on a closed
    // page; Playwright then reports that error outside any test.
    it("still judges the test when the rerun reported errors outside any test", (t) => {
      const warn = t.mock.method(console, "warn", () => {});
      const stray =
        "Error: page.apply: Target page, context or browser has been closed";
      const rerun = (error) => ({
        errors: [{ message: `${stray}\n\nFailed worker ran 1 test:` }],
        suites: [
          {
            title: "expect-misc.spec.ts",
            file: "expect-misc.spec.ts",
            suites: [
              {
                title: "toHaveCount",
                specs: [
                  {
                    title: "eventually pass non-zero",
                    file: "expect-misc.spec.ts",
                    tests: [
                      {
                        results: [
                          { status: "failed", error: { message: error } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      const testId =
        "expect-misc.spec.ts > toHaveCount > eventually pass non-zero";
      const marker = "__pwLiteSabotagedMatcher: Locator.toHaveCount";

      assert.doesNotThrow(() =>
        sabotageVerdict(
          sabotageRerunEntries(
            rerun(`Error: ${marker} was withheld for promotion review.`)
          ),
          testId,
          "Locator.toHaveCount",
          marker
        )
      );
      assert.throws(
        () =>
          sabotageVerdict(
            sabotageRerunEntries(rerun("Error: some unrelated failure")),
            testId,
            "Locator.toHaveCount",
            marker
          ),
        /not for the expected reason/
      );
      assert.ok(
        warn.mock.calls.some((call) => call.arguments.join(" ").includes(stray))
      );
    });
  });

  it("requires public expect evidence for existing _expect baseline entries", () => {
    const baseline = {
      reviewed: [
        {
          id: "expect-to-have-text.spec.ts > should work",
          method: "Locator._expect",
          matcher: "Locator.toHaveText",
          evidence: "historical locator assertion",
        },
      ],
    };
    const withoutWrapper = compareBaseline(
      [
        {
          id: baseline.reviewed[0].id,
          file: "expect-to-have-text.spec.ts",
          status: "passed",
          execution: { entered: ["Locator._expect"], failures: [] },
        },
      ],
      baseline,
      ["expect-to-have-text.spec.ts"]
    );
    assert.deepEqual(withoutWrapper.regressions, [baseline.reviewed[0].id]);

    const withWrapper = compareBaseline(
      [
        {
          id: baseline.reviewed[0].id,
          file: "expect-to-have-text.spec.ts",
          status: "passed",
          execution: {
            entered: ["Locator._expect"],
            expect: ["Locator.toHaveText"],
            expectPaths: [
              {
                matcher: "Locator.toHaveText",
                method: "Locator._expect",
              },
            ],
            failures: [],
          },
        },
      ],
      baseline,
      ["expect-to-have-text.spec.ts"]
    );
    assert.deepEqual(withWrapper.regressions, []);

    const independentEvidence = compareBaseline(
      [
        {
          id: baseline.reviewed[0].id,
          file: "expect-to-have-text.spec.ts",
          status: "passed",
          execution: {
            entered: ["Locator._expect"],
            expect: ["Locator.toHaveText"],
            expectPaths: [
              {
                matcher: "Locator.toHaveValue",
                method: "Locator._expect",
              },
            ],
            failures: [],
          },
        },
      ],
      baseline,
      ["expect-to-have-text.spec.ts"]
    );
    assert.deepEqual(independentEvidence.regressions, [
      baseline.reviewed[0].id,
    ]);
  });

  it("requires public matcher evidence when promoting an expect assertion", () => {
    const expectEntry = {
      id: "expect-to-have-text.spec.ts > should work",
      status: "passed",
      execution: {
        entered: ["Locator._expect"],
        expect: ["Locator.toHaveText"],
        expectPaths: [
          {
            matcher: "Locator.toHaveText",
            method: "Locator._expect",
          },
        ],
        failures: [],
      },
    };
    assert.deepEqual(
      reviewedPromotion(
        [expectEntry],
        expectEntry.id,
        "Locator._expect",
        "public toHaveText checks the locator text",
        "Locator.toHaveText"
      ),
      {
        id: expectEntry.id,
        method: "Locator._expect",
        matcher: "Locator.toHaveText",
        evidence: "public toHaveText checks the locator text",
      }
    );
    assert.throws(
      () =>
        reviewedPromotion(
          [expectEntry],
          expectEntry.id,
          "Locator._expect",
          "missing matcher"
        ),
      /explicit matcher/
    );
    assert.throws(() =>
      reviewedPromotion(
        [expectEntry],
        expectEntry.id,
        "Locator._expect",
        "wrong matcher",
        "Locator.toHaveValue"
      )
    );
  });

  it("rejects cross-owner public matcher evidence", () => {
    const id = "expect-misc.spec.ts > owner alignment";
    const entry = {
      id,
      file: "expect-misc.spec.ts",
      status: "passed",
      execution: {
        entered: ["Locator._expect", "Page._expect"],
        expect: ["Page.toHaveTitle", "Locator.toHaveText"],
        expectPaths: [
          { matcher: "Page.toHaveTitle", method: "Page._expect" },
          { matcher: "Locator.toHaveText", method: "Locator._expect" },
        ],
        failures: [],
      },
    };

    assert.deepEqual(
      compareBaseline(
        [entry],
        {
          reviewed: [
            {
              id,
              method: "Locator._expect",
              matcher: "Page.toHaveTitle",
              evidence: "wrong owner",
            },
          ],
        },
        ["expect-misc.spec.ts"]
      ).regressions,
      [id]
    );
    assert.throws(
      () =>
        reviewedPromotion(
          [entry],
          id,
          "Locator._expect",
          "wrong owner",
          "Page.toHaveTitle"
        ),
      /owner must match/
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

describe("blockingRegressions", () => {
  const names = ["jshandle.spec.ts"];
  const passing = (id, entered) => ({
    id,
    file: "jshandle.spec.ts",
    status: "passed",
    execution: { entered, failures: [] },
  });
  const renamed = "jshandle.spec.ts > renamed owner";
  const other = "jshandle.spec.ts > other";
  const baseline = {
    reviewed: [
      { id: renamed, method: "JSHandle.asElement", evidence: "reviewed" },
      { id: other, method: "Page.evaluate", evidence: "reviewed" },
    ],
  };
  const correction = { id: renamed, method: "ElementHandle.asElement" };

  it("lets an entry whose method only changed owner be re-recorded", () => {
    const entries = [
      passing(renamed, ["Page.evaluateHandle", "ElementHandle.asElement"]),
      passing(other, ["Page.evaluate"]),
    ];
    assert.deepEqual(compareBaseline(entries, baseline, names).regressions, [
      renamed,
    ]);
    assert.deepEqual(
      blockingRegressions(
        entries,
        baseline,
        names,
        [correction],
        new Set([renamed])
      ),
      []
    );
  });

  it("keeps a regression blocking unless its promotion is a re-record", () => {
    const entries = [
      passing(renamed, ["ElementHandle.asElement"]),
      { ...passing(other, ["Page.evaluate"]), status: "failed" },
    ];
    // Not listed as a re-record, the renamed entry blocks like any regression.
    assert.deepEqual(
      blockingRegressions(entries, baseline, names, [correction], new Set()),
      [other, renamed].sort()
    );
    // Re-recording one entry leaves every other regression blocking.
    assert.deepEqual(
      blockingRegressions(
        entries,
        baseline,
        names,
        [correction],
        new Set([renamed])
      ),
      [other]
    );
  });

  it("refuses a re-record that is not an owner rename of a regressed entry", () => {
    const refused = [
      // Nothing to correct: the recorded method still certifies.
      [[passing(renamed, ["JSHandle.asElement"])], correction],
      // Another member is a new promotion, not a correction.
      [
        [passing(renamed, ["ElementHandle.click"])],
        { id: renamed, method: "ElementHandle.click" },
      ],
      // The same method cannot be a rename.
      [
        [passing(renamed, ["ElementHandle.asElement"])],
        { id: renamed, method: "JSHandle.asElement" },
      ],
      // A failing test is a regression to investigate.
      [
        [
          {
            ...passing(renamed, ["ElementHandle.asElement"]),
            status: "failed",
          },
        ],
        correction,
      ],
      // A matcher change is not a rename.
      [
        [passing(renamed, ["ElementHandle.asElement"])],
        { ...correction, matcher: "Locator.toBeVisible" },
      ],
      // Only an existing reviewed entry can be re-recorded.
      [
        [passing("jshandle.spec.ts > new", ["ElementHandle.asElement"])],
        { id: "jshandle.spec.ts > new", method: "ElementHandle.asElement" },
      ],
    ];
    for (const [entries, promotion] of refused)
      assert.throws(
        () =>
          blockingRegressions(
            [...entries, passing(other, ["Page.evaluate"])],
            baseline,
            names,
            [promotion],
            new Set([promotion.id])
          ),
        /re-record/
      );
  });

  it("refuses an owner change that is not a listed owner correction", () => {
    // Page.evaluate regressed while a Locator.evaluate in the same test still
    // runs: renaming the owner would hide an unrelated regression.
    const entries = [
      passing(renamed, ["JSHandle.asElement"]),
      passing(other, ["Locator.evaluate"]),
    ];
    assert.deepEqual(compareBaseline(entries, baseline, names).regressions, [
      other,
    ]);
    assert.throws(
      () =>
        blockingRegressions(
          entries,
          baseline,
          names,
          [{ id: other, method: "Locator.evaluate" }],
          new Set([other])
        ),
      /from Page\.evaluate as Locator\.evaluate only if that is a listed owner correction \(JSHandle -> ElementHandle\)/
    );
  });

  it("refuses a re-record when the entry's method now runs natively", () => {
    const native = (entered, nativeMethods) => ({
      ...passing(renamed, entered),
      execution: { entered, failures: [], native: nativeMethods },
    });
    // Whether or not the adapter still records the old method, running it
    // natively is a regression, never an owner rename.
    for (const entry of [
      native(["ElementHandle.asElement"], ["JSHandle.asElement"]),
      native(
        ["JSHandle.asElement", "ElementHandle.asElement"],
        ["JSHandle.asElement"]
      ),
    ])
      assert.throws(
        () =>
          blockingRegressions(
            [entry, passing(other, ["Page.evaluate"])],
            baseline,
            names,
            [correction],
            new Set([renamed])
          ),
        /runs JSHandle\.asElement natively/
      );
  });
});

describe("parsePromotionArgs", () => {
  const id = "jshandle.spec.ts > a";

  it("reads a plain promotion, a matcher and a re-record", () => {
    assert.deepEqual(
      parsePromotionArgs([
        id,
        "Page.click",
        "clicks",
        "x.spec.ts > b",
        "Locator._expect",
        "--matcher",
        "Locator.toHaveText",
        "matches",
        "x.spec.ts > c",
        "ElementHandle.asElement",
        "--re-record",
        "renamed",
      ]),
      {
        requests: [
          { id, method: "Page.click", evidence: "clicks" },
          {
            id: "x.spec.ts > b",
            method: "Locator._expect",
            matcher: "Locator.toHaveText",
            evidence: "matches",
          },
          {
            id: "x.spec.ts > c",
            method: "ElementHandle.asElement",
            evidence: "renamed",
          },
        ],
        reRecords: new Set(["x.spec.ts > c"]),
      }
    );
  });

  it("names the conflict when --re-record and --matcher are combined, in either order", () => {
    for (const flags of [
      ["--matcher", "Locator.toHaveText", "--re-record"],
      ["--re-record", "--matcher", "Locator.toHaveText"],
    ])
      assert.throws(
        () => parsePromotionArgs([id, "Locator._expect", ...flags, "evidence"]),
        /--re-record cannot be combined with --matcher/
      );
  });

  it("refuses a flag as the matcher name", () => {
    assert.throws(
      () =>
        parsePromotionArgs([
          id,
          "Locator._expect",
          "--matcher",
          "--re-record",
          "evidence",
        ]),
      /--matcher requires a public matcher name/
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
    assert.deepEqual(entries[0].titlePath, ["describe block", "nested test"]);
  });

  it("reads observed outcomes of tests the harness expects to fail", () => {
    // Shape recorded from Playwright 1.62.1 for tests marked by testInfo.fail().
    const execution = { entered: ["Locator.click"], failures: [] };
    const knownFailure = (title, testStatus, result) => ({
      title,
      file: "tests/upstream/locator-click.spec.ts",
      tests: [
        {
          expectedStatus: "failed",
          status: testStatus,
          annotations: [
            { type: "fail" },
            {
              type: "adapter-execution",
              description: JSON.stringify(execution),
            },
          ],
          results: [result],
        },
      ],
    });
    const report = {
      suites: [
        {
          title: "locator-click.spec.ts",
          file: "tests/upstream/locator-click.spec.ts",
          specs: [
            knownFailure("now passes", "unexpected", { status: "passed" }),
            knownFailure("still fails", "expected", {
              status: "failed",
              error: { message: "Error: expect(received).toBe(expected)" },
            }),
            knownFailure("times out", "unexpected", {
              status: "timedOut",
              error: { message: "Test timeout of 15000ms exceeded." },
            }),
          ],
        },
      ],
    };

    const entries = parseReport(report);

    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.status, failurePhase(entry)]),
      [
        ["locator-click.spec.ts > now passes", "passed", "passed"],
        ["locator-click.spec.ts > still fails", "failed", "assertion"],
        ["locator-click.spec.ts > times out", "timedOut", "timeout"],
      ]
    );
    assert.deepEqual(entries[0].execution, execution);
    assert.deepEqual(
      compareBaseline(entries, { reviewed: [] }, ["locator-click.spec.ts"])
        .newlyPassing,
      ["locator-click.spec.ts > now passes"]
    );
  });
});

// ── reportErrorMessages ──────────────────────────────────────────────

describe("reportErrorMessages", () => {
  it("returns empty array for report with no errors", () => {
    assert.deepEqual(reportErrorMessages({ suites: [], errors: [] }), []);
  });

  it("returns empty array when errors key is missing", () => {
    assert.deepEqual(reportErrorMessages({ suites: [] }), []);
  });

  it("returns the first line of a collection error", () => {
    const report = {
      suites: [],
      errors: [
        {
          message:
            "Error: Cannot find module '/some/path/coreBundle'\nmore stack",
        },
      ],
    };
    const errs = reportErrorMessages(report);
    assert.equal(errs.length, 1);
    assert.ok(errs[0].includes("Cannot find module"));
  });

  it("returns every top-level error", () => {
    const report = {
      suites: [],
      errors: [{ message: "Error: first" }, { message: "Error: second" }],
    };
    assert.equal(reportErrorMessages(report).length, 2);
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
      {
        ...makeEntry("page-goto.spec.ts > diagnostic", "passed"),
        execution: null,
      },
    ];
    const baseline = { reviewed: [] };
    const result = compareBaseline(entries, baseline, names);
    const reconciled =
      result.currentPassing.length +
      result.diagnosticPassed +
      result.failed +
      result.skipped;
    assert.equal(reconciled, result.total);
  });
});

// ── sabotageGrep ────────────────────────────────────────────────────

describe("sabotageGrep", () => {
  it("greps a plain title with no enclosing describe", () => {
    assert.equal(sabotageGrep(["should click"]), "should click");
  });

  it("joins a nested describe's title path with spaces", () => {
    assert.equal(
      sabotageGrep(["toHaveText with regex", "pass"]),
      "toHaveText with regex pass"
    );
  });

  it("keeps a title that itself contains the id separator intact", () => {
    assert.equal(
      sabotageGrep(["should work with > combinator and spaces"]),
      "should work with > combinator and spaces"
    );
  });

  it("escapes regex metacharacters in the title", () => {
    assert.equal(
      sabotageGrep(["should handle a.b (c)"]),
      "should handle a\\.b \\(c\\)"
    );
  });
});
