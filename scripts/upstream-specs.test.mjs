import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { corpus } from "../tests/upstream/corpus.ts";
import { renderCorpusTs } from "./upstream-specs.mjs";

const corpusUrl = new URL("../tests/upstream/corpus.ts", import.meta.url);

test("a sync round-trip rewrites corpus.ts exactly as it is committed", async () => {
  assert.equal(
    await renderCorpusTs(corpus.specs),
    readFileSync(corpusUrl, "utf8"),
    "pnpm upstream:sync would rewrite tests/upstream/corpus.ts beyond the spec hashes: anything the writer does not emit — a hand-added export, a source path, its formatting — is dropped on the next sync."
  );
});
