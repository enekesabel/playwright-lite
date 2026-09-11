/**
 * Package-local replacements for Playwright's tests/config/utils.
 *
 * Provides the utility functions imported by upstream spec files through
 * the relative path ../config/utils. These are infrastructure helpers,
 * not compatibility operations.
 */
import type { Frame, Page } from "@playwright/test";

export async function attachFrame(
  page: Page,
  frameId: string,
  url: string
): Promise<Frame> {
  const handle = await page.evaluateHandle(
    async ({ frameId, url }) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.id = frameId;
      document.body.appendChild(frame);
      await new Promise((resolve) => (frame.onload = resolve));
      return frame;
    },
    { frameId, url }
  );
  const element = handle.asElement()!;
  return (await element.contentFrame())!;
}

export async function detachFrame(page: Page, frameId: string): Promise<void> {
  await page.evaluate((frameId) => {
    document.getElementById(frameId)?.remove();
  }, frameId);
}

export async function rafraf(target: Page | Frame, count = 1) {
  for (let i = 0; i < count; i++) {
    await target.evaluate(
      async () =>
        new Promise((f) =>
          requestAnimationFrame(() => requestAnimationFrame(f))
        )
    );
  }
}

export function expectedSSLError(
  browserName: string,
  platform: string,
  channel: string | undefined
): RegExp {
  if (browserName === "chromium")
    return /net::(ERR_CERT_AUTHORITY_INVALID|ERR_CERT_INVALID)/;
  if (browserName === "webkit") {
    if (platform === "darwin")
      return /The certificate for this server is invalid/;
    if (platform === "win32" && channel !== "webkit-wsl")
      return /SSL peer certificate or SSH remote key was not OK/;
    return /Unacceptable TLS certificate|Operation was cancelled/;
  }
  if (browserName === "firefox" && isBidiChannel(channel))
    return /MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT/;
  return /SSL_ERROR_UNKNOWN/;
}

export function isBidiChannel(channel: string | undefined): boolean {
  return (
    channel?.startsWith("bidi-chrom") ||
    channel?.startsWith("moz-firefox") ||
    false
  );
}

/**
 * Mirrors ayme-labs/playwright@b25d782e3fbdf21abdae60e974e49b78ca07e828
 * tests/config/utils.ts for the unchanged ARIA snapshot specs.
 */
export function unshift(snapshot: string): string {
  const lines = snapshot.split("\n");
  let whitespacePrefixLength = 100;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)/);
    if (match && match[1].length < whitespacePrefixLength)
      whitespacePrefixLength = match[1].length;
  }
  return lines
    .filter((line) => line.trim())
    .map((line) => line.substring(whitespacePrefixLength))
    .join("\n");
}
