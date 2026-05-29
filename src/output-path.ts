import { basename, dirname, extname, join } from "node:path";

export const timestampOutputPath = (path: string, date = new Date()): string => {
  const extension = extname(path);
  const name = basename(path, extension);
  return join(dirname(path), `${name}-${formatTimestamp(date)}${extension}`);
};

const formatTimestamp = (date: Date): string =>
  [
    date.getFullYear().toString(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    "-",
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
    "-",
    padDatePart(date.getMilliseconds(), 3),
  ].join("");

const padDatePart = (value: number, length = 2): string => value.toString().padStart(length, "0");
