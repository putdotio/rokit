import { NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { CliError, CliOutput, Command as EffectCommand } from "effect/unstable/cli";
import PackageJson from "../package.json" with { type: "json" };
import type { Command, ParsedCli } from "./cli-types.js";
import { artifactCommands } from "./cli-artifact-commands.js";
import { controlCommands } from "./cli-control-commands.js";
import { debugCommands } from "./cli-debug-commands.js";
import { metaCommands } from "./cli-meta-commands.js";
import { observationCommands } from "./cli-observation-commands.js";
import {
  DryRunGlobal,
  FieldsGlobal,
  InputJsonGlobal,
  JsonGlobal,
  OutputGlobal,
  type RokitGlobalFlagContext,
  readCliOptions,
} from "./cli-options.js";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";

const effectCliVersion = PackageJson.version;

const silentConsole: Console.Console = {
  assert() {},
  clear() {},
  count() {},
  countReset() {},
  debug() {},
  dir() {},
  dirxml() {},
  error() {},
  group() {},
  groupCollapsed() {},
  groupEnd() {},
  info() {},
  log() {},
  table() {},
  time() {},
  timeEnd() {},
  timeLog() {},
  trace() {},
  warn() {},
};

const defaultCliFormatter = CliOutput.defaultFormatter();

const rokitCliFormatter: CliOutput.Formatter = {
  ...defaultCliFormatter,
  formatHelpDoc: (doc) => defaultCliFormatter.formatHelpDoc(withoutNoExtraArg(doc)),
};

export const runEffectCliActionEffect = Effect.fn("runEffectCliAction")(function* (
  argv: readonly string[],
) {
  const capture = () => Effect.succeed(undefined);
  yield* runRokitCli(argv, capture).pipe(Effect.mapError(normalizeCliError));
});

export const parseEffectCliEffect: (
  argv: readonly string[],
) => Effect.Effect<ParsedCli, RokitError> = Effect.fn("parseEffectCli")(function* (argv) {
  let parsedCli: ParsedCli | undefined;
  const capture = (command?: Command) =>
    readCliOptions().pipe(
      Effect.flatMap((options) =>
        Effect.sync(() => {
          parsedCli =
            command === undefined
              ? options
              : {
                  ...options,
                  command,
                };
        }),
      ),
    );

  yield* runRokitCli(argv, capture, silentConsole).pipe(Effect.mapError(normalizeCliError));

  if (parsedCli === undefined) {
    return yield* Effect.fail(new InvalidInput({ message: "No command parsed" }));
  }

  return parsedCli;
});

export const parseEffectCli = async (argv: readonly string[]): Promise<ParsedCli> =>
  await Effect.runPromise(parseEffectCliEffect(argv));

export const effectCliCommandNames = (): readonly string[] =>
  makeRokitCommand(() => Effect.succeed(undefined)).subcommands.flatMap((group) =>
    group.commands.map((command) => command.name),
  );

const runRokitCli = (
  argv: readonly string[],
  capture: (command?: Command) => Effect.Effect<void, never, RokitGlobalFlagContext>,
  consoleService?: Console.Console,
) => {
  const program = EffectCommand.runWith(makeRokitCommand(capture), {
    version: effectCliVersion,
  })(argv).pipe(
    Effect.provide(CliOutput.layer(rokitCliFormatter)),
    Effect.provide(NodeServices.layer),
  );

  return consoleService === undefined
    ? program
    : program.pipe(Effect.provideService(Console.Console, consoleService));
};

const normalizeCliError = (error: unknown): RokitError => {
  if (CliError.isCliError(error) && error._tag === "ShowHelp") {
    return new InvalidInput({ message: formatShowHelpError(error) });
  }

  return normalizeError(error);
};

const formatShowHelpError = (error: CliError.ShowHelp): string => {
  const first = error.errors[0];

  if (
    first?._tag === "InvalidValue" &&
    first.option === "extra" &&
    first.expected.startsWith("Unexpected extra argument:")
  ) {
    return first.expected;
  }

  return first?.message ?? "Help requested";
};

const withoutNoExtraArg = (
  doc: Parameters<CliOutput.Formatter["formatHelpDoc"]>[0],
): Parameters<CliOutput.Formatter["formatHelpDoc"]>[0] => ({
  ...doc,
  args: doc.args?.filter((arg) => arg.name !== "extra"),
  usage: doc.usage.replace(/ ?<extra\.\.\.>/g, ""),
});

const makeRokitCommand = (
  capture: (command?: Command) => Effect.Effect<void, never, RokitGlobalFlagContext>,
) =>
  EffectCommand.make("rokit", {}, () => capture()).pipe(
    EffectCommand.withDescription("Roku device harness helper."),
    EffectCommand.withSubcommands([
      ...metaCommands(capture),
      ...observationCommands(capture),
      ...debugCommands(capture),
      ...controlCommands(capture),
      ...artifactCommands(capture),
    ]),
    EffectCommand.withGlobalFlags([
      DryRunGlobal,
      FieldsGlobal,
      InputJsonGlobal,
      JsonGlobal,
      OutputGlobal,
    ]),
  );
