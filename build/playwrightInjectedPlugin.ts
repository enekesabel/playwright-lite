import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const mimeId = "virtual:playwright-lite-mime";
const resolvedMimeId = `\0${mimeId}`;
const expectedMimeTypesSha256 =
  "fa27e7587fa87945e8afee7402ccdbc8463bc6cf0fc9c85f907f884402571986";
const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
const globalsId = "virtual:playwright-lite-globals";
const resolvedGlobalsId = `\0${globalsId}`;
const expectedSnapshotNamesSha256 =
  "c7886655860636f469af6e7a681cd049264e60819e4a56590f03025815353191";
/**
 * Read by the pinned protocol serializer's `isURL`/`isDate` and value parser.
 * Pinned Playwright runs that serializer in Node, where the page cannot reach
 * them; here it runs in the page, so they join the pinned snapshot.
 */
const protocolSerializerGlobals = ["URL", "Date"];

export function playwrightInjectedPlugin() {
  const globals = [...readPinnedSnapshotNames(), ...protocolSerializerGlobals];
  // Rebinds each captured name for the source that follows, as pinned
  // `mainWorldGlobalsSnapshotSource` does in front of the pinned sources.
  const snapshotBindings = (names: readonly string[] = globals) => [
    `import { pageGlobals as __pwLitePageGlobals } from ${JSON.stringify(globalsId)};`,
    `const { ${names.join(", ")} } = __pwLitePageGlobals;`,
  ];
  return {
    name: "playwright-lite-injected",
    /**
     * This package's own modules read the same globals as the pinned scripts
     * (`new Promise`, `Date.now()`, `instanceof Element`, …) and share the
     * page's realm, so each one gets the snapshot bindings the pinned sources
     * get: only the names its text mentions, on its first line so that stack
     * line numbers are unchanged. Globals read as `window.<name>` stay live.
     */
    transform(code: string, id: string) {
      const path = id.split("?", 1)[0];
      if (
        !path.startsWith(sourceDirectory) ||
        !path.endsWith(".ts") ||
        path.endsWith(".d.ts") ||
        path.endsWith(".test.ts")
      )
        return;
      const names = globals.filter((name) =>
        new RegExp(`\\b${name}\\b`).test(code)
      );
      if (names.length === 0) return;
      return { code: snapshotBindings(names).join(" ") + code, map: null };
    },
    resolveId(id: string) {
      if (id === injectedId) return resolvedInjectedId;
      if (id === evaluationId) return resolvedEvaluationId;
      if (id === mimeId) return resolvedMimeId;
      if (id === globalsId) return resolvedGlobalsId;
    },
    load(id: string) {
      if (id === resolvedMimeId)
        return `export const extensionToType = new Map(Object.entries(${readPinnedMimeTypes()}));`;
      // Taken once, when the adapter module evaluates, the way pinned
      // `saveGlobalsSnapshotSource` takes `__pwSnapshotGlobals` at page start:
      // a page that later deletes or replaces one of these globals no longer
      // reaches the code that reads the snapshot.
      if (id === resolvedGlobalsId)
        return `export const pageGlobals = Object.freeze({ ${globals
          .map((name) => `${name}: globalThis.${name}`)
          .join(", ")} });`;
      if (id === resolvedEvaluationId) {
        return [
          ...snapshotBindings(),
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
          "export { LiteUtilityScript as UtilityScript, serializeAsCallArgument, parseEvaluationResultValue, serializeValue, parseSerializedValue, kBindingsControllerProperty, kFunctionBindingPrefix };",
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
        ...snapshotBindings(),
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
        // The pinned client's `asLocatorDescription` and `locatorCustomDescription`
        // are tree-shaken from this bundle; the primitives they call are not.
        "export { LiteInjectedScript as InjectedScript, liteGetByTestIdSelector as getByTestIdSelector, liteParseAriaSnapshot as parseAriaSnapshot, asLocator, parseSelector };",
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

/**
 * The globals pinned server/javascript.ts rebinds in front of the injected and
 * utility sources when a browser has no isolated utility world
 * (`snapshottedFunctionBuiltins` and `snapshottedObjectBuiltins`, read by
 * `mainWorldGlobalsSnapshotSource`), taken from the playwright-core 1.62.1
 * bundle of the pinned commit. Chromium runs those sources in the utility
 * world instead; this adapter shares the page's realm, so it takes the same
 * snapshot.
 */
function readPinnedSnapshotNames(): string[] {
  const require = createRequire(import.meta.url);
  const bundle = readFileSync(
    require.resolve("playwright-core/lib/coreBundle"),
    "utf8"
  );
  const names = [
    "snapshottedFunctionBuiltins",
    "snapshottedObjectBuiltins",
  ].flatMap((list) => {
    const match = new RegExp(`${list} = \\[([^\\]]*)\\];`).exec(bundle);
    if (!match)
      throw new Error(`The pinned Playwright bundle has no ${list} list.`);
    return [
      ...match[1].replace(/\/\/.*$/gm, "").matchAll(/"([A-Za-z]+)"/g),
    ].map(([, name]) => name);
  });
  const sha256 = createHash("sha256")
    .update(JSON.stringify(names))
    .digest("hex");
  if (sha256 !== expectedSnapshotNamesSha256)
    throw new Error(
      `The pinned Playwright globals snapshot (sha256 ${sha256}) does not match the reviewed build.`
    );
  return names;
}

/**
 * The extension table pinned server/fileUploadUtils.ts consults through
 * `mime.getType(name)`: the mime@4.1.0 instance that playwright-core 1.62.1,
 * the release of the pinned commit, bundles as utilsBundle's `mime`. Mime has
 * no public enumeration, so the table comes from its `_getTestState()` hook.
 */
function readPinnedMimeTypes(): string {
  const require = createRequire(import.meta.url);
  const { mime } = require("playwright-core/lib/utilsBundle") as {
    mime: { _getTestState(): { types: Map<string, string> } };
  };
  const json = JSON.stringify(Object.fromEntries(mime._getTestState().types));
  const sha256 = createHash("sha256").update(json).digest("hex");
  if (sha256 !== expectedMimeTypesSha256)
    throw new Error(
      `The pinned Playwright mime table (sha256 ${sha256}) does not match the reviewed build.`
    );
  return json;
}
