/**
 * The corpus test-ID convention, shared by the baseline tooling and the
 * pageTest fixture.
 *
 * It lives outside corpus.ts because `pnpm upstream:sync` regenerates that
 * file wholesale from the recorded spec hashes.
 */

/** Stable corpus test ID: "specFilename > title path". */
export function stableTestId(file: string, titles: readonly string[]): string {
  const filename = file.split("/").pop() ?? file;
  return [filename, ...titles.filter(Boolean)].join(" > ");
}
