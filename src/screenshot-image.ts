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
    if (kind === "IDAT") {
      image.copy(compressed, compressedLength, offset + 8, end - 4);
      compressedLength += length;
    }
    offset = end;
  }
  // pngjs's interlaced sync decoder has no inflate limit. Bound and verify the
  // complete zlib stream first, including its checksum, before decoding pixels.
  const channelCounts: Readonly<Record<number, number | undefined>> = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };
  const channels = channelCounts[image[25] ?? -1];
  const depth = image[24];
  if (channels === undefined || depth === undefined || ![1, 2, 4, 8, 16].includes(depth)) {
    throw new Error("invalid PNG pixel format");
  }
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

// jpeg-js stops a scan at any non-restart marker, even when MCUs remain.
// Count the restart boundaries the scan's dimensions require before decoding.
function jpegRestartCount(frame: Buffer | undefined, scan: Buffer, interval: number): number {
  if (interval === 0) return 0;
  if (!frame || frame.length < 6 || scan.length < 4) throw new Error("invalid JPEG scan header");
  const componentCount = frame[5] ?? 0;
  const selectorCount = scan[0] ?? 0;
  if (frame.length !== 6 + 3 * componentCount || scan.length !== 4 + 2 * selectorCount)
    throw new Error("invalid JPEG scan header");
  const components = new Map<number, { h: number; v: number }>();
  let maxH = 1;
  let maxV = 1;
  for (let index = 6; index < frame.length; index += 3) {
    const id = frame[index];
    const sampling = frame[index + 1] ?? 0;
    const h = sampling >> 4;
    const v = sampling & 15;
    if (id === undefined || h < 1 || h > 4 || v < 1 || v > 4 || components.has(id))
      throw new Error("invalid JPEG frame component");
    components.set(id, { h, v });
    maxH = Math.max(maxH, h);
    maxV = Math.max(maxV, v);
  }
  if (selectorCount === 0) throw new Error("invalid JPEG scan components");
  for (let index = 1; index < 1 + 2 * selectorCount; index += 2) {
    if (!components.has(scan[index] ?? -1)) throw new Error("invalid JPEG scan component");
  }
  const width = frame.readUInt16BE(3);
  const height = frame.readUInt16BE(1);
  let mcus = Math.ceil(width / (8 * maxH)) * Math.ceil(height / (8 * maxV));
  if (selectorCount === 1) {
    const component = components.get(scan[1] ?? -1);
    if (!component) throw new Error("invalid JPEG scan component");
    mcus =
      Math.ceil((Math.ceil(width / 8) * component.h) / maxH) *
      Math.ceil((Math.ceil(height / 8) * component.v) / maxV);
  }
  return Math.max(0, Math.ceil(mcus / interval) - 1);
}

function validateJpegSegments(image: Buffer): void {
  let entropy = false;
  let hasScanData = false;
  let frame: Buffer | undefined;
  let interval = 0;
  let expectedRestarts = 0;
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
    if (entropy && restarts !== expectedRestarts) throw new Error("incomplete JPEG restart scan");
    if (marker === 0xd9) {
      if (!hasScanData) throw new Error("JPEG has no image scan data");
      return;
    }
    if (offset + 2 > image.length) throw new Error("truncated JPEG segment");
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > image.length)
      throw new Error("invalid JPEG segment length");
    const segment = image.subarray(offset + 2, offset + length);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) frame = segment;
    if (marker === 0xdd) {
      if (segment.length !== 2) throw new Error("invalid JPEG restart interval");
      interval = segment.readUInt16BE(0);
    }
    if (marker === 0xda) {
      expectedRestarts = jpegRestartCount(frame, segment, interval);
      restarts = 0;
    }
    offset += length;
    entropy = marker === 0xda;
  }
  throw new Error("missing JPEG end marker");
}
