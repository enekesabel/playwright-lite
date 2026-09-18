// CI lints each PR title, which becomes the squash-merged commit on `main` that Release Please reads.
// `feat` and `fix` are only for adapter behaviour consumers see, because they bump the version and
// appear in the changelog. Use `test` for harness, corpus and promotion work.
// Scope is optional. The only allowed scope is `release`, for Release Please's `chore(release): x.y.z`.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "build",
        "chore",
        "ci",
        "docs",
        "feat",
        "fix",
        "perf",
        "refactor",
        "style",
        "test",
      ],
    ],
    "scope-enum": [2, "always", ["release"]],
    "header-max-length": [2, "always", 100],
  },
};
