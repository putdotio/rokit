import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { validateScreenshotImage } from "../src/screenshot-image.js";
import { jpegImage, pngImage } from "./fixtures/images.js";

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

describe("screenshot image integrity", () => {
  it.each([jpegImage, pngImage, interlacedPng])(
    "decodes a genuine image without changing its bytes",
    (image) => {
      const original = Buffer.from(image);
      expect(() => validateScreenshotImage(image)).not.toThrow();
      expect(image).toEqual(original);
    },
  );

  it.each([
    ["empty", Buffer.alloc(0)],
    ["HTML", Buffer.from("<html>error</html>")],
    ["truncated JPEG", jpegImage.subarray(0, jpegImage.length - 10)],
    ["corrupt JPEG segment", corruptJpeg],
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
