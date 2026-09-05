import { crc32, inflateSync } from "node:zlib";
import { decode } from "jpeg-js";
import { PNG } from "pngjs";

// Allow DCI 4K as well as Roku's UHD output without allocating for arbitrary dimensions.
const maxPixels = 4096 * 2160;
export const maxScreenshotBytes = 64 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validateScreenshotImage(bytes: Uint8Array): void {
  const image = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (image.subarray(0, 8).equals(pngSignature)) {
    validatePng(image);
  } else if (image[0] === 0xff && image[1] === 0xd8) {
    validateJpegSegments(image);
    decode(image, {
      tolerantDecoding: false,
      maxResolutionInMP: maxPixels / 1_000_000,
      maxMemoryUsageInMB: 256,
    });
  } else {
    throw new Error("screenshot response is not a JPEG or PNG image");
  }
}

function validatePng(image: Buffer): void {
  if (
    image.length < 33 ||
    image.readUInt32BE(8) !== 13 ||
    image.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("invalid PNG header");
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width === 0 || height === 0 || width > 8192 || height > 8192 || width * height > maxPixels) {
    throw new Error("PNG screenshot exceeds supported dimensions");
  }

  const compressed = Buffer.allocUnsafe(image.length);
  let compressedLength = 0;
  for (let offset = 8; offset < image.length;) {
    if (image.length - offset < 12) throw new Error("truncated PNG chunk");
    const length = image.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > image.length) throw new Error("truncated PNG chunk");
    const kind = image.toString("ascii", offset + 4, offset + 8);
    if (crc32(image.subarray(offset + 4, end - 4)) !== image.readUInt32BE(end - 4)) {
      throw new Error("invalid PNG chunk checksum");
    }
    if (kind === "IHDR" && offset !== 8) throw new Error("duplicate PNG header");
    if (kind === "IEND" && length !== 0) throw new Error("invalid PNG end chunk");
    if (kind === "IDAT") {
      image.copy(compressed, compressedLength, offset + 8, end - 4);
      compressedLength += length;
    }
    offset = end;
  }
  // pngjs's interlaced sync decoder has no inflate limit. Bound and verify the
  // complete zlib stream first, including its checksum, before decoding pixels.
  const pixelFormats: Readonly<
    Record<number, { channels: number; depths: readonly number[] } | undefined>
  > = {
    0: { channels: 1, depths: [1, 2, 4, 8, 16] },
    2: { channels: 3, depths: [8, 16] },
    3: { channels: 1, depths: [1, 2, 4, 8] },
    4: { channels: 2, depths: [8, 16] },
    6: { channels: 4, depths: [8, 16] },
  };
  const format = pixelFormats[image[25] ?? -1];
  const depth = image[24];
  if (format === undefined || depth === undefined || !format.depths.includes(depth)) {
    throw new Error("invalid PNG pixel format");
  }
  const channels = format.channels;
  const passes =
    image[28] === 1
      ? ([
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ] as const)
      : ([[0, 0, 1, 1]] as const);
  let expectedBytes = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns > 0) expectedBytes += rows * (1 + Math.ceil((columns * channels * depth) / 8));
  }
  const inflated = inflateSync(compressed.subarray(0, compressedLength), {
    maxOutputLength: expectedBytes,
  });
  if (inflated.length !== expectedBytes) throw new Error("invalid PNG pixel data length");
  PNG.sync.read(image, { checkCRC: true });
}

function validateJpegSegments(image: Buffer): void {
  let entropy = false;
  let hasScanData = false;
  let restarts = 0;
  for (let offset = 2; offset < image.length;) {
    if (image[offset++] !== 0xff) {
      if (entropy) {
        hasScanData = true;
        continue;
      }
      throw new Error("invalid JPEG marker");
    }
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset++];
    if (entropy && marker === 0) {
      hasScanData = true;
      continue;
    }
    if (entropy && marker !== undefined && marker >= 0xd0 && marker <= 0xd7) {
      if (marker !== 0xd0 + (restarts % 8)) throw new Error("invalid JPEG restart sequence");
      restarts += 1;
      continue;
    }
    if (marker === 0xd9) {
      if (!hasScanData) throw new Error("JPEG has no image scan data");
      return;
    }
    if (offset + 2 > image.length) throw new Error("truncated JPEG segment");
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > image.length)
      throw new Error("invalid JPEG segment length");
    if (marker === 0xda) restarts = 0;
    offset += length;
    entropy = marker === 0xda;
  }
  throw new Error("missing JPEG end marker");
}
