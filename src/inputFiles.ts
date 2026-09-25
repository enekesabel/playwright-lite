import type { Page } from "@playwright/test";

export type InputFiles = Parameters<Page["setInputFiles"]>[1];

/**
 * Pinned 26a9e47 client/elementHandle.ts converts payloads before resolving the
 * input; server/fileUploadUtils.ts encodes the bytes for InjectedScript and
 * fills an empty or omitted MIME type from the name. Keep that format without
 * importing Node's Buffer or filesystem into the browser.
 *
 * `Locator.drop` carries the same converted payloads in the pinned client, so
 * `method` names the member whose message a rejected payload belongs to.
 *
 * The pinned mime table is a separate chunk, loaded only when a payload needs
 * its type inferred, so callers that always pass `mimeType` never fetch it.
 */
export async function inputFilePayloads(
  files: InputFiles,
  method = "setInputFiles"
) {
  const items = Array.isArray(files) ? files : [files];
  if (items.some((item) => typeof item === "string"))
    throw new Error(
      `${method}: file paths are not supported; pass in-memory Playwright payloads.`
    );
  const payloads = items.map((item) => {
    if (
      !item ||
      typeof item === "string" ||
      item instanceof Blob ||
      typeof item.name !== "string" ||
      // `mimeType` is `string?` in the pinned protocol.
      (item.mimeType !== undefined && typeof item.mimeType !== "string") ||
      !(item.buffer instanceof Uint8Array)
    )
      throw new TypeError(
        `${method}: expected { name, mimeType, buffer } with an optional string MIME type and byte buffer; File and Blob are not supported.`
      );
    return item;
  });
  // Same aggregate in-memory limit as pinned client/elementHandle.ts.
  if (
    payloads.reduce((size, item) => size + item.buffer.byteLength, 0) >=
    50 * 1024 * 1024
  )
    throw new Error(`${method}: in-memory payloads must total less than 50Mb.`);
  // Only consulted for a payload without `mimeType`.
  const extensionToType: ReadonlyMap<string, string> = payloads.some(
    (item) => !item.mimeType
  )
    ? (await import("virtual:playwright-lite-mime")).extensionToType
    : new Map();
  return payloads.map((item) => {
    let binary = "";
    for (let offset = 0; offset < item.buffer.byteLength; offset += 8192)
      binary += String.fromCharCode(
        ...item.buffer.subarray(offset, offset + 8192)
      );
    return {
      name: item.name,
      mimeType:
        item.mimeType ||
        mimeTypeForName(item.name, extensionToType) ||
        "application/octet-stream",
      buffer: btoa(binary),
    };
  });
}

/** Pinned mime@4.1.0 `Mime.getType`, which the pinned server calls with the payload name. */
function mimeTypeForName(
  name: string,
  extensionToType: ReadonlyMap<string, string>
): string | null {
  const last = name.replace(/^.*[/\\]/s, "").toLowerCase();
  const extension = last.replace(/^.*\./s, "").toLowerCase();
  const hasPath = last.length < name.length;
  const hasDot = extension.length < last.length - 1;
  if (!hasDot && hasPath) return null;
  return extensionToType.get(extension) ?? null;
}
