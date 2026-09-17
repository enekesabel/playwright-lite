import { expect, it } from "vitest";
import { inputFilePayloads } from "./inputFiles";

// Playwright's payload type uses Node Buffer. Its browser representation is a
// Uint8Array; no Buffer polyfill or browser-only public overload is necessary.
function payload(
  name = "test.txt",
  bytes = new TextEncoder().encode("contents")
) {
  return { name, mimeType: "text/plain", buffer: bytes as Buffer };
}

it("rejects malformed payloads and oversized buffers before encoding", () => {
  expect(() => inputFilePayloads({ ...payload(), mimeType: "" })).toThrow(
    "non-empty MIME type"
  );
  expect(() =>
    inputFilePayloads(payload("huge", new Uint8Array(50 * 1024 * 1024)))
  ).toThrow("less than 50Mb");
});
