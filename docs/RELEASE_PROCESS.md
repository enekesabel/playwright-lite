# Release process

Release Please reads Conventional Commits on `main` and keeps one release PR up to date.

1. Merge normal changes into `main`.
2. Review the Release Please PR. Check the proposed version and changelog. `fix:` bumps patch, `feat:` bumps minor, and a breaking change bumps major. Before 1.0, a breaking change can propose `1.0.0`.
3. Merge the release PR when the version is correct.
4. The `release-please` job creates the Git tag and GitHub Release. CI tests that commit, then the `publish-npm` job publishes the tested tarball.

Versions below 1.0 publish under npm's `alpha` tag. Version 1.0.0 and later publish under `latest`.

## Failed publication

If npm publishing fails without a code change, fix the external cause and use GitHub Actions' **Re-run failed jobs** on the same workflow run. If the fix changes repository code, merge the fix and release a new version.
