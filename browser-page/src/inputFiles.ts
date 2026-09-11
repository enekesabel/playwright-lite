import type { Page } from "@playwright/test";

export type InputFiles = Parameters<Page["setInputFiles"]>[1];

/**
 * Pinned b25d782 client/elementHandle.ts converts payloads before resolving the
 * input; server/fileUploadUtils.ts encodes the bytes for InjectedScript. Keep
 * that format without importing Node's Buffer or filesystem into the browser.
 */
export function inputFilePayloads(files: InputFiles) {
  const items = Array.isArray(files) ? files : [files];
  if (items.some((item) => typeof item === "string"))
    throw new Error(
      "setInputFiles: file paths are not supported; pass in-memory Playwright payloads."
    );
  const payloads = items.map((item) => {
    if (
      !item ||
      typeof item === "string" ||
      item instanceof Blob ||
      typeof item.name !== "string" ||
      typeof item.mimeType !== "string" ||
      !item.mimeType ||
      !(item.buffer instanceof Uint8Array)
    )
      throw new TypeError(
        "setInputFiles: expected { name, mimeType, buffer } with a non-empty MIME type and byte buffer; File and Blob are not supported."
      );
    return item;
  });
  // Same aggregate in-memory limit as pinned client/elementHandle.ts.
  if (
    payloads.reduce((size, item) => size + item.buffer.byteLength, 0) >=
    50 * 1024 * 1024
  )
    throw new Error(
      "setInputFiles: in-memory payloads must total less than 50Mb."
    );
  return payloads.map((item) => {
    let binary = "";
    for (let offset = 0; offset < item.buffer.byteLength; offset += 8192)
      binary += String.fromCharCode(
        ...item.buffer.subarray(offset, offset + 8192)
      );
    return { name: item.name, mimeType: item.mimeType, buffer: btoa(binary) };
  });
}
