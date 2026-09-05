import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { validateScreenshotImage } from "../src/screenshot-image.js";
import {
  baselineRestartJpeg,
  progressivePartialRestartJpeg,
  grayscalePartialRestartJpeg,
  progressiveRestartJpeg,
  grayscaleRestartJpeg,
  jpegImage,
  pngImage,
} from "./fixtures/images.js";

function pngChunk(kind: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(kind, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function smallPng(rawPixels: Buffer, interlaced = false): Buffer {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, Number(interlaced)]);
  return Buffer.concat([
    pngImage.subarray(0, 8),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rawPixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const badCrc = Buffer.from(pngImage);
badCrc[badCrc.length - 1] ^= 1;
const largePng = Buffer.from(pngImage);
largePng.writeUInt32BE(100_000, 16);
const corruptJpeg = Buffer.from(jpegImage);
corruptJpeg[corruptJpeg.indexOf(Buffer.from([0xff, 0xda])) + 2] = 0xff;
const largeJpeg = Buffer.from(jpegImage);
const frameOffset = largeJpeg.indexOf(Buffer.from([0xff, 0xc0]));
largeJpeg.writeUInt16BE(10000, frameOffset + 5);
largeJpeg.writeUInt16BE(10000, frameOffset + 7);
const interlacedPng = smallPng(Buffer.from([0, 255, 0, 0, 255]), true);

const scanOffset = jpegImage.indexOf(Buffer.from([0xff, 0xda]));
const scanlessJpeg = Buffer.concat([jpegImage.subarray(0, scanOffset), Buffer.from([0xff, 0xd9])]);
const emptyScanJpeg = Buffer.concat([
  jpegImage.subarray(0, scanOffset + 2 + jpegImage.readUInt16BE(scanOffset + 2)),
  Buffer.from([0xff, 0xd9]),
]);
// Each copy of the genuine fixture's entropy encodes one complete 8×8 MCU.
function restartJpeg(declaredMcus: number, includedMcus: number): Buffer {
  const prefix = Buffer.from(jpegImage.subarray(0, scanOffset));
  prefix.writeUInt16BE(declaredMcus * 8, frameOffset + 7);
  const scanEnd = scanOffset + 2 + jpegImage.readUInt16BE(scanOffset + 2);
  const entropy = jpegImage.subarray(scanEnd, -2);
  return Buffer.concat([
    prefix,
    Buffer.from([0xff, 0xdd, 0, 4, 0, 1]),
    jpegImage.subarray(scanOffset, scanEnd),
    ...Array.from({ length: includedMcus }, (_, index) =>
      index === 0
        ? entropy
        : Buffer.concat([Buffer.from([0xff, 0xd0 + ((index - 1) % 8)]), entropy]),
    ),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const finalInterval = restartJpeg(2, 2);
const finalIntervalStart = finalInterval.indexOf(Buffer.from([0xff, 0xd0])) + 2;
const missingFinalInterval = Buffer.concat([
  finalInterval.subarray(0, finalIntervalStart),
  Buffer.from([0xff, 0xd9]),
]);
const truncatedFinalInterval = Buffer.concat([
  finalInterval.subarray(0, finalIntervalStart + 1),
  Buffer.from([0xff, 0xd9]),
]);
const badRestartSequence = restartJpeg(2, 2);
badRestartSequence[badRestartSequence.indexOf(Buffer.from([0xff, 0xd0])) + 1] = 0xd1;
const restartWithoutInterval = restartJpeg(2, 2);
restartWithoutInterval.writeUInt16BE(
  0,
  restartWithoutInterval.indexOf(Buffer.from([0xff, 0xdd])) + 4,
);

const ancillary = pngChunk("tEXt", Buffer.from("note\0synthetic"));
ancillary[ancillary.length - 1] ^= 1;
const ancillaryCrcPng = Buffer.concat([pngImage.subarray(0, 33), ancillary, pngImage.subarray(33)]);
const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const missingZlibChecksumPng = Buffer.concat([
  pngImage.subarray(0, 8),
  pngChunk("IHDR", header),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255])).subarray(0, -4)),
  pngChunk("IEND", Buffer.alloc(0)),
]);

describe("screenshot image integrity", () => {
  it.each([
    jpegImage,
    pngImage,
    interlacedPng,
    restartJpeg(2, 2),
    restartJpeg(10, 10),
    baselineRestartJpeg,
    progressiveRestartJpeg,
    grayscaleRestartJpeg,
    progressivePartialRestartJpeg,
    grayscalePartialRestartJpeg,
  ])("decodes a genuine image without changing its bytes", (image) => {
    const original = Buffer.from(image);
    expect(() => validateScreenshotImage(image)).not.toThrow();
    expect(image).toEqual(original);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["HTML", Buffer.from("<html>error</html>")],
    ["truncated JPEG", jpegImage.subarray(0, jpegImage.length - 10)],
    ["corrupt JPEG segment", corruptJpeg],
    ["JPEG without a scan", scanlessJpeg],
    ["JPEG early EOI before first restart", restartJpeg(2, 1)],
    ["JPEG early EOI after restart", restartJpeg(3, 2)],
    ["JPEG missing final interval", missingFinalInterval],
    ["JPEG truncated final interval", truncatedFinalInterval],
    ["JPEG restart sequence", badRestartSequence],
    ["JPEG restart without interval", restartWithoutInterval],
    ["JPEG without scan data", emptyScanJpeg],
    ["PNG ancillary checksum", ancillaryCrcPng],
    ["PNG missing zlib checksum", missingZlibChecksumPng],
    ["oversized JPEG", largeJpeg],
    ["truncated PNG header", pngImage.subarray(0, 24)],
    ["truncated PNG chunk", pngImage.subarray(0, pngImage.length - 5)],
    ["PNG checksum", badCrc],
    ["oversized PNG", largePng],
    ["short PNG pixels", smallPng(Buffer.from([0, 255]))],
    ["PNG expansion beyond dimensions", smallPng(Buffer.alloc(1_000_000))],
    ["interlaced PNG expansion beyond dimensions", smallPng(Buffer.alloc(1_000_000), true)],
  ] as const)("rejects %s", (_label, image) => {
    expect(() => validateScreenshotImage(image)).toThrow();
  });
});
