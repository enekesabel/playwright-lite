import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const expectedArtifactBytes = 330629;
const expectedArtifactSha256 =
  "5f2da9b42f2ae9ce59c268c28342a2873b98c49fa095f89843c83b9e3b27d986";
const injectedId = "virtual:playwright-lite-injected";
const resolvedInjectedId = `\0${injectedId}`;
const evaluationId = "virtual:playwright-lite-evaluation";
const resolvedEvaluationId = `\0${evaluationId}`;
const expectedUtilitySha256 =
  "2fb69a612599d5fddb55f22bfe191f7f7c3e9044eb6cfbfc0849c7270b7422c3";
const expectedUtilityBytes = 11373;
const expectedProtocolBytes = 7268;
const expectedProtocolSha256 =
  "04db394dbb46a317b529271a013d034a82db1babfbd642a9be23c21adbe2ad2e";

export function playwrightInjectedPlugin() {
  return {
    name: "playwright-lite-injected",
    resolveId(id: string) {
      if (id === injectedId) return resolvedInjectedId;
      if (id === evaluationId) return resolvedEvaluationId;
    },
    load(id: string) {
      if (id === resolvedEvaluationId) {
        return [
          "const protocol = (() => {",
          "const module = { exports: {} }; const exports = module.exports;",
          // The pinned protocol serializer uses only Buffer.from(ArrayBuffer, offset, length).
          // Uint8Array supplies that byte view in the browser without a Node Buffer polyfill.
          "const Buffer = { from: (buffer, byteOffset, length) => new Uint8Array(buffer, byteOffset, length).slice() };",
          readScriptSource(
            "protocolSerializerSource.ts",
            expectedProtocolBytes,
            expectedProtocolSha256
          ),
          "return module.exports; })();",
          "const { serializeValue, parseSerializedValue } = protocol;",
          "const module = { exports: {} };",
          "const exports = module.exports;",
          readScriptSource(
            "utilityScriptSource.ts",
            expectedUtilityBytes,
            expectedUtilitySha256
          ),
          "const LiteUtilityScript = module.exports.UtilityScript();",
          "export { LiteUtilityScript as UtilityScript, serializeAsCallArgument, parseEvaluationResultValue, serializeValue, parseSerializedValue };",
        ].join("\n");
      }
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
        readScriptSource(
          "injectedScriptSource.ts",
          expectedArtifactBytes,
          expectedArtifactSha256
        ),
        "const LiteInjectedScript = module.exports.InjectedScript();",
        "const liteGetByTestIdSelector = getByTestIdSelector;",
        "const liteParseAriaSnapshot = (text) => { const result = parseAriaSnapshot(yaml, text); if (result.errors.length) throw new Error(result.errors[0].message); return result.fragment; };",
        "export { LiteInjectedScript as InjectedScript, liteGetByTestIdSelector as getByTestIdSelector, liteParseAriaSnapshot as parseAriaSnapshot };",
      ].join("\n");
    },
  };
}

function readScriptSource(
  name: string,
  expectedBytes: number,
  expectedSha256: string
): string {
  const artifact = readFileSync(
    new URL(`./generated/${name}`, import.meta.url)
  );
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (artifact.byteLength !== expectedBytes || sha256 !== expectedSha256) {
    throw new Error(
      `The pinned Playwright ${name} artifact does not match the reviewed build.`
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
