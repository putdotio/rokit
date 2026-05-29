import { Option } from "effect";
import { Argument, Flag } from "effect/unstable/cli";
import type { DescribedField } from "./cli-types.js";
import { validateRemoteKey } from "./ecp.js";

export const stringArgument = (name: string, description: string) =>
  Argument.string(name).pipe(Argument.withDescription(description));

export const stringArgumentField = (field: DescribedField) =>
  stringArgument(field.name, field.description);

export const pathArgument = (name: string, description: string) =>
  Argument.path(name).pipe(Argument.withDescription(description));

export const pathArgumentField = (field: DescribedField) =>
  pathArgument(field.name, field.description);

export const fileArgument = (
  name: string,
  description: string,
  options: Parameters<typeof Argument.file>[1],
) => Argument.file(name, options).pipe(Argument.withDescription(description));

export const fileArgumentField = (
  field: DescribedField,
  options: Parameters<typeof Argument.file>[1],
) => fileArgument(field.name, field.description, options);

export const choiceArgument = <const Choices extends readonly [string, ...string[]]>(
  name: string,
  choices: Choices,
  description: string,
) => Argument.choice(name, choices).pipe(Argument.withDescription(description));

export const choiceArgumentField = <const Choices extends readonly [string, ...string[]]>(
  field: DescribedField,
  choices: Choices,
) => choiceArgument(field.name, choices, field.description);

export const positiveIntegerFlag = (name: string, label: string, description: string) =>
  Flag.integer(name).pipe(
    Flag.filter(
      (value) => value > 0,
      (value) => `Invalid ${label}: ${value}`,
    ),
    Flag.withDescription(description),
  );

export const positiveIntegerFlagField = (field: DescribedField, label = field.name) =>
  positiveIntegerFlag(field.name, label, field.description);

export const nonNegativeIntegerFlag = (name: string, label: string, description: string) =>
  Flag.integer(name).pipe(
    Flag.filter(
      (value) => value >= 0,
      (value) => `Invalid ${label}: ${value}`,
    ),
    Flag.withDescription(description),
  );

export const nonNegativeIntegerFlagField = (field: DescribedField, label = field.name) =>
  nonNegativeIntegerFlag(field.name, label, field.description);

export const stringFlagField = (field: DescribedField) =>
  Flag.string(field.name).pipe(Flag.withDescription(field.description));

export const remoteKeyArgument = (field: DescribedField) =>
  stringArgumentField(field).pipe(
    Argument.mapTryCatch(validateRemoteKeyArgument, formatThrownMessage),
  );

export const launchParamsFlag = (field: DescribedField) =>
  // Roku query params can contain "=" in the value; Effect's keyValuePair primitive
  // rejects that, so this parser splits only on the first separator.
  Flag.string(field.name).pipe(
    Flag.withMetavar("key=value"),
    Flag.withDescription(field.description),
    Flag.atMost(Number.MAX_SAFE_INTEGER),
    Flag.mapTryCatch(parseLaunchParams, formatThrownMessage),
  );

export const optionToUndefined = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (inner) => inner,
  });

const validateRemoteKeyArgument = (key: string): string => {
  validateRemoteKey(key);
  return key;
};

const parseLaunchParams = (pairs: readonly string[]): ReadonlyMap<string, string> => {
  const params = new Map<string, string>();

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex < 1) {
      throw new Error(`Invalid --param value "${pair}". Expected key=value.`);
    }

    params.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
  }

  return params;
};

const formatThrownMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
