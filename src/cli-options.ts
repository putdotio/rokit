import { Effect, Option } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";
import { globalOption } from "./cli-command-metadata.js";
import type { CliOptions, OutputMode } from "./cli-types.js";

export type RokitGlobalFlagContext =
  | "effect/unstable/cli/GlobalFlag/dry-run"
  | "effect/unstable/cli/GlobalFlag/fields"
  | "effect/unstable/cli/GlobalFlag/input-json"
  | "effect/unstable/cli/GlobalFlag/json"
  | "effect/unstable/cli/GlobalFlag/output";

export const DryRunGlobal = GlobalFlag.setting("dry-run")({
  flag: Flag.boolean("dry-run").pipe(
    Flag.withDefault(false),
    Flag.withDescription(globalOption("dry-run").description),
  ),
});

export const FieldsGlobal = GlobalFlag.setting("fields")({
  flag: Flag.string("fields").pipe(
    Flag.optional,
    Flag.withDescription(globalOption("fields").description),
  ),
});

export const InputJsonGlobal = GlobalFlag.setting("input-json")({
  flag: Flag.string("input-json").pipe(
    Flag.optional,
    Flag.withDescription(globalOption("input-json").description),
  ),
});

export const JsonGlobal = GlobalFlag.setting("json")({
  flag: Flag.boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription(globalOption("json").description),
  ),
});

export const OutputGlobal = GlobalFlag.setting("output")({
  flag: Flag.choice("output", ["json", "text"]).pipe(
    Flag.optional,
    Flag.withDescription(globalOption("output").description),
  ),
});

export const readCliOptions: () => Effect.Effect<CliOptions, never, RokitGlobalFlagContext> =
  Effect.fn("readCliOptions")(function* () {
    const dryRun = yield* DryRunGlobal;
    const fieldMask = optionToUndefined(yield* FieldsGlobal);
    const inputJson = optionToUndefined(yield* InputJsonGlobal);
    const json = yield* JsonGlobal;
    const output = outputModeFromOption(yield* OutputGlobal);
    const fields = parseFieldMask(fieldMask);

    return {
      dryRun,
      fields,
      inputJson,
      outputMode: output ?? inferredOutputMode({ fields, inputJson, json }),
    };
  });

export const inferErrorOutputMode = (argv: readonly string[]): OutputMode => {
  if (hasLongFlag(argv, "json")) {
    return "json";
  }

  const output = readLongFlagValue(argv, "output");
  if (output === "json") {
    return "json";
  }

  if (output === "text") {
    return "text";
  }

  if (hasLongFlag(argv, "input-json") || hasLongFlag(argv, "fields")) {
    return "json";
  }

  return defaultOutputMode();
};

const defaultOutputMode = (): OutputMode => (process.stdout.isTTY ? "text" : "json");

const inferredOutputMode = (options: {
  readonly fields: readonly string[];
  readonly inputJson?: string;
  readonly json: boolean;
}): OutputMode => {
  if (options.json || options.inputJson !== undefined || options.fields.length > 0) {
    return "json";
  }

  return defaultOutputMode();
};

const parseFieldMask = (value: string | undefined): readonly string[] => {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
};

const outputModeFromOption = (value: Option.Option<string>): OutputMode | undefined => {
  const output = optionToUndefined(value);

  if (output === "json" || output === "text") {
    return output;
  }

  return undefined;
};

const optionToUndefined = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (inner) => inner,
  });

const hasLongFlag = (argv: readonly string[], name: string): boolean =>
  argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));

const readLongFlagValue = (argv: readonly string[], name: string): string | undefined => {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === `--${name}`) {
      return argv[index + 1];
    }

    const prefix = `--${name}=`;
    if (arg?.startsWith(prefix) === true) {
      return arg.slice(prefix.length);
    }
  }

  return undefined;
};
