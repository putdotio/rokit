import type { CommandResult, OutputMode } from "./cli-types.js";

export const printResult = (
  outputMode: OutputMode,
  result: CommandResult,
  fields: readonly string[],
): void => {
  if (outputMode === "json") {
    console.log(JSON.stringify(applyFields(result, fields), null, 2));
    return;
  }

  if (result.message !== undefined) {
    console.log(result.message);
    return;
  }

  console.log(JSON.stringify(result.data, null, 2));
};

export const printError = (
  outputMode: OutputMode,
  message: string,
  _fields: readonly string[],
): void => {
  if (outputMode === "json") {
    console.error(JSON.stringify({ error: { message }, status: "failed" }, null, 2));
    return;
  }

  console.error(message);
};

export const applyFields = (value: unknown, fields: readonly string[]): unknown => {
  if (fields.length === 0) {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const field of fields) {
    const path = field.split(".");
    const selected = pickField(value, path);

    if (selected !== undefined) {
      mergeField(output, path, selected);
    }
  }

  preserveStatusMetadata(value, output);
  return output;
};

const preserveStatusMetadata = (source: unknown, target: Record<string, unknown>): void => {
  if (!isRecord(source)) {
    return;
  }

  for (const key of ["status", "partial", "failedObservations"]) {
    if (key in source) {
      target[key] = source[key];
    }
  }
};

type FieldContainer = Record<string, unknown> | unknown[];

const pickField = (source: unknown, path: readonly string[]): unknown => {
  const [head, ...tail] = path;

  if (!head) {
    return;
  }

  if (Array.isArray(source)) {
    const index = parseArrayIndex(head);
    return index === undefined || index >= source.length
      ? undefined
      : pickFieldOrValue(source[index], tail);
  }

  if (!isRecord(source) || !(head in source)) {
    return;
  }

  return pickFieldOrValue(source[head], tail);
};

const pickFieldOrValue = (source: unknown, path: readonly string[]): unknown =>
  path.length === 0 ? source : pickField(source, path);

const mergeField = (target: FieldContainer, path: readonly string[], value: unknown): void => {
  const [head, ...tail] = path;

  if (head === undefined) {
    return;
  }

  if (tail.length === 0) {
    setContainerValue(target, head, value);
    return;
  }

  const child = getContainerValue(target, head);
  const childTarget = isContainer(child) ? child : makeContainer(tail[0]);
  setContainerValue(target, head, childTarget);
  mergeField(childTarget, tail, value);
};

const getContainerValue = (target: FieldContainer, key: string): unknown => {
  if (Array.isArray(target)) {
    const index = parseArrayIndex(key);
    return index === undefined ? undefined : target[index];
  }

  return target[key];
};

const setContainerValue = (target: FieldContainer, key: string, value: unknown): void => {
  if (Array.isArray(target)) {
    const index = parseArrayIndex(key);
    if (index !== undefined) {
      target[index] = value;
    }
    return;
  }

  target[key] = value;
};

const makeContainer = (nextKey: string | undefined): FieldContainer =>
  nextKey !== undefined && parseArrayIndex(nextKey) !== undefined ? [] : {};

const isContainer = (value: unknown): value is FieldContainer =>
  isRecord(value) || Array.isArray(value);

const parseArrayIndex = (value: string): number | undefined =>
  /^\d+$/.test(value) ? Number(value) : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
