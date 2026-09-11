import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const expectedArtifactBytes = 330629;
const expectedArtifactSha256 =
  "5f2da9b42f2ae9ce59c268c28342a2873b98c49fa095f89843c83b9e3b27d986";
const injectedId = "virtual:playwright-lite-injected";
const resolvedInjectedId = `\0${injectedId}`;

export function playwrightInjectedPlugin() {
  return {
    name: "playwright-lite-injected",
    resolveId(id: string) {
      if (id === injectedId) return resolvedInjectedId;
    },
    load(id: string) {
      if (id !== resolvedInjectedId) return;
      const require = createRequire(import.meta.url);
      const yamlPath = resolve(
        dirname(require.resolve("yaml/package.json")),
        "browser/index.js"
      );
      return [
        `import yaml from ${JSON.stringify(yamlPath)};`,
        "const module = { exports: {} };",
        "const exports = module.exports;",
        readInjectedScriptSource(),
        "const LiteInjectedScript = module.exports.InjectedScript();",
        "const liteGetByTestIdSelector = getByTestIdSelector;",
        "const liteParseAriaSnapshot = (text) => { const result = parseAriaSnapshot(yaml, text); if (result.errors.length) throw new Error(result.errors[0].message); return result.fragment; };",
        "export { LiteInjectedScript as InjectedScript, liteGetByTestIdSelector as getByTestIdSelector, liteParseAriaSnapshot as parseAriaSnapshot };",
      ].join("\n");
    },
  };
}

function readInjectedScriptSource(): string {
  const artifact = readFileSync(
    new URL("./generated/injectedScriptSource.ts", import.meta.url)
  );
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (
    artifact.byteLength !== expectedArtifactBytes ||
    sha256 !== expectedArtifactSha256
  ) {
    throw new Error(
      "The pinned Playwright InjectedScript artifact does not match the reviewed build."
    );
  }
  const text = artifact.toString("utf8");
  const prefix = "export const source = ";
  if (!text.startsWith(prefix) || !text.endsWith(";"))
    throw new Error("Unsupported InjectedScript artifact format.");
  const source: unknown = JSON.parse(text.slice(prefix.length, -1));
  if (typeof source !== "string")
    throw new Error("InjectedScript source must be a string.");
  return source;
}
