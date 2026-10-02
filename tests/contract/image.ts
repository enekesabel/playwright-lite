/** Reads screenshot bytes back in the browser that encoded them. */

export type DecodedImage = {
  width: number;
  height: number;
  /** The RGBA channels of one pixel. */
  pixel: (x: number, y: number) => number[];
  /** Every RGBA channel, row by row. */
  data: Uint8ClampedArray;
};

export async function decode(bytes: Uint8Array): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>])
  );
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    data,
    pixel: (x, y) =>
      Array.from(
        data.subarray(
          (y * canvas.width + x) * 4,
          (y * canvas.width + x) * 4 + 4
        )
      ),
  };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The image type the bytes' signature names. */
export function signature(bytes: Uint8Array): "png" | "jpeg" | "webp" | "?" {
  if (ascii(bytes, 1, 4) === "PNG") return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "webp";
  return "?";
}

/**
 * Pinned 26a9e47 packages/utils/webp/webp.ts `isLosslessWebp`: the first
 * image chunk is `VP8L` for lossless and `VP8 ` for lossy encoding.
 */
export function isLosslessWebp(bytes: Uint8Array): boolean {
  if (signature(bytes) !== "webp") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, offset + 4);
    if (fourcc === "VP8L") return true;
    if (fourcc === "VP8 ") return false;
    const size = view.getUint32(offset + 4, true);
    offset += 8 + size + (size & 1);
  }
  return false;
}
