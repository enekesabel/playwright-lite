import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const expectedArtifactBytes = 331_512;
const expectedArtifactSha256 =
  "8517fd96ce7384ba9068116c21ebe3e2d0b61d123483df938b15aa4382ad92df";
const playwrightInjectedId = "virtual:ayme-playwright-injected";
const resolvedPlaywrightInjectedId = `\0${playwrightInjectedId}`;

export function playwrightInjectedPlugin() {
  return {
    name: "ayme-playwright-injected",
    resolveId(id: string) {
      if (id === playwrightInjectedId) return resolvedPlaywrightInjectedId;
    },
    load(id: string) {
      if (id !== resolvedPlaywrightInjectedId) return;
      const source = readInjectedScriptSource();
      return [
        `import yaml from ${JSON.stringify(yamlBrowserPath())};`,
        "const module = { exports: {} };",
        "const exports = module.exports;",
        source,
        "const AymeInjectedScript = module.exports.InjectedScript();",
        "const aymeGetByTestIdSelector = getByTestIdSelector;",
        "const aymeParseAriaSnapshot = (text) => { const result = parseAriaSnapshot(yaml, text); if (result.errors.length) throw new Error(result.errors[0].message); return result.fragment; };",
        "export { AymeInjectedScript as InjectedScript, aymeGetByTestIdSelector as getByTestIdSelector, aymeParseAriaSnapshot as parseAriaSnapshot };",
      ].join("\n");
    },
  };
}

function yamlBrowserPath() {
  const require = createRequire(import.meta.url);
  return resolve(
    dirname(require.resolve("yaml/package.json")),
    "browser/index.js"
  );
}

function readInjectedScriptSource() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("playwright-core/package.json");
  const artifactPath = resolve(
    dirname(packagePath),
    "src/generated/injectedScriptSource.ts"
  );
  const artifact = readFileSync(artifactPath);
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (
    artifact.byteLength !== expectedArtifactBytes ||
    sha256 !== expectedArtifactSha256
  ) {
    throw new Error(
      "The pinned playwright-core InjectedScript artifact does not match the reviewed build."
    );
  }

  const text = artifact.toString("utf8");
  const prefix = "export const source = ";
  if (!text.startsWith(prefix) || !text.endsWith(";"))
    throw new Error(
      "The pinned playwright-core InjectedScript artifact has an unsupported format."
    );

  const source: unknown = JSON.parse(text.slice(prefix.length, -1));
  if (
    typeof source !== "string" ||
    !source.includes("captureAriaSnapshot(root)")
  ) {
    throw new Error(
      "The pinned playwright-core InjectedScript artifact lacks captureAriaSnapshot."
    );
  }
  return source;
}
