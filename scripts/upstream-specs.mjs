#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { corpus, specNames } from "../tests/upstream/corpus.ts";

export { specNames };

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(__dirname, "../tests/upstream/corpus.ts");
const upstreamDir = resolve(__dirname, "../tests/upstream");

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], "file://").href;

if (isMain) {
  const command = process.argv[2];
  if (command === "sync") await sync();
  else if (command === "check") await check();
  else {
    console.error("Usage: upstream-specs.mjs <sync|check>");
    process.exit(1);
  }
}

/** Fetch a spec file from the pinned upstream commit. */
async function fetchSpec(spec) {
  const { repository, commit, basePath } = corpus.source;
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${basePath}/${spec}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Failed to fetch ${spec}: ${response.status} ${response.statusText}`
    );
  return response.text();
}

async function sync() {
  mkdirSync(upstreamDir, { recursive: true });

  /** @type {Record<string, string>} */
  const updatedSpecs = {};
  let copied = 0;

  for (const spec of specNames) {
    process.stdout.write(`  ${spec} … `);
    const content = await fetchSpec(spec);
    writeFileSync(resolve(upstreamDir, spec), content, "utf8");
    updatedSpecs[spec] = sha256(content);
    copied++;
    console.log("ok");
  }

  writeCorpusTs(updatedSpecs);
  console.log(`\nSynced ${copied} specs. corpus.ts updated.`);
}

/**
 * Rewrite corpus.ts with updated spec hashes.
 * @param {Record<string, string>} specs
 */
function writeCorpusTs(specs) {
  const specEntries = Object.entries(specs)
    .map(([name, hash]) => `    "${name}": "${hash}",`)
    .join("\n");

  const source = `export const corpus = {
  source: {
    repository: "${corpus.source.repository}",
    commit: "${corpus.source.commit}",
    basePath: "${corpus.source.basePath}",
  },
  specs: {
${specEntries}
  },
} as const;

export type UpstreamSpecName = keyof typeof corpus.specs;

export const specNames: readonly UpstreamSpecName[] = Object.keys(
  corpus.specs
) as UpstreamSpecName[];
`;

  writeFileSync(corpusPath, source, "utf8");
}

/**
 * Verify local spec files match the hashes recorded in corpus.ts.
 * @returns {{ drifted: number, missing: number }}
 */
export function verifyIntegrity() {
  let drifted = 0;
  let missing = 0;

  for (const spec of specNames) {
    const localPath = resolve(upstreamDir, spec);
    if (!existsSync(localPath)) {
      console.error(`  MISSING  ${spec}`);
      missing++;
      continue;
    }

    const localHash = sha256(readFileSync(localPath, "utf8"));
    const expectedHash = corpus.specs[spec];

    if (localHash !== expectedHash) {
      console.error(`  DRIFTED  ${spec}`);
      console.error(`    expected: ${expectedHash}`);
      console.error(`    actual:   ${localHash}`);
      drifted++;
    } else {
      console.log(`  ok  ${spec}`);
    }
  }

  return { drifted, missing };
}

async function check() {
  const { drifted, missing } = verifyIntegrity();

  if (process.argv.includes("--upstream")) {
    console.log("\nChecking upstream drift…");
    let upstreamDrifted = 0;
    for (const spec of specNames) {
      const localPath = resolve(upstreamDir, spec);
      if (!existsSync(localPath)) continue;

      const localContent = readFileSync(localPath, "utf8");
      const upstreamContent = await fetchSpec(spec);

      if (localContent !== upstreamContent) {
        console.error(`  UPSTREAM DRIFTED  ${spec}`);
        upstreamDrifted++;
      }
    }
    if (upstreamDrifted > 0) {
      console.error(`\n${upstreamDrifted} upstream drifted.`);
      process.exit(1);
    }
  }

  if (drifted > 0 || missing > 0) {
    console.error(`\n${drifted} drifted, ${missing} missing.`);
    process.exit(1);
  }
  console.log(`\nAll ${specNames.length} specs match corpus hashes.`);
}
