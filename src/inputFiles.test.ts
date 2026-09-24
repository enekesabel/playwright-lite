import { expect, it } from "vitest";
import { inputFilePayloads } from "./inputFiles";

// Playwright's payload type uses Node Buffer. Its browser representation is a
// Uint8Array; no Buffer polyfill or browser-only public overload is necessary.
function payload(
  name = "test.txt",
  bytes = new TextEncoder().encode("contents"),
  mimeType = "text/plain"
) {
  return { name, mimeType, buffer: bytes as Buffer };
}

it("rejects malformed payloads and oversized buffers before encoding", () => {
  expect(() =>
    inputFilePayloads({ ...payload(), mimeType: 1 as unknown as string })
  ).toThrow("MIME type");
  expect(() =>
    inputFilePayloads(payload("huge", new Uint8Array(50 * 1024 * 1024)))
  ).toThrow("less than 50Mb");
});

it("infers an empty MIME type from the name like pinned mime.getType", () => {
  // Expected values are what pinned playwright-core 1.62.1's bundled
  // mime.getType returns for each name, or its octet-stream fallback for null.
  const cases: [string, string][] = [
    ["a.txt", "text/plain"],
    ["A.PNG", "image/png"],
    ["archive.tar.gz", "application/gzip"],
    ["dir\\data.JSON", "application/json"],
    ["x.ts", "video/mp2t"],
    ["txt", "text/plain"],
    [".txt", "text/plain"],
    ["dir/txt", "application/octet-stream"],
    ["noext", "application/octet-stream"],
    ["file.", "application/octet-stream"],
    ["a.unknownext", "application/octet-stream"],
    ["", "application/octet-stream"],
  ];
  const inferred = inputFilePayloads(
    cases.map(([name]) => payload(name, undefined, ""))
  ).map((item) => item.mimeType);
  expect(inferred).toEqual(cases.map(([, mimeType]) => mimeType));
});
