import { encode } from "jpeg-js";
import { PNG } from "pngjs";

const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
export const jpegImage = encode({ width: 2, height: 1, data: pixels }, 90).data;
const png = new PNG({ width: 2, height: 1 });
png.data = pixels;
export const pngImage = PNG.sync.write(png);
