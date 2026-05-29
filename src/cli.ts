import { Effect, FileSystem, Path, Stdio } from "effect";
import { parseEffectCliEffect, runEffectCliActionEffect } from "./cli-command.js";
import { commandNeedsTarget } from "./cli-command-traits.js";
import { parseInputJsonEffect } from "./cli-input-json.js";
import { resolveInputJsonSource } from "./cli-input-source.js";
import { inferErrorOutputMode } from "./cli-options.js";
import { printError, printResult } from "./cli-output.js";
import { runCommandEffect } from "./cli-runner.js";
import type { Command, OutputMode, ParsedCli } from "./cli-types.js";
import { InvalidInput, normalizeError, renderError, type RokitError } from "./errors.js";
import type { RokuContext } from "./roku-context.js";
import { loadEnv, loadLocalEnv, requireTarget } from "./runtime.js";

export const mainEffect = Effect.fn("mainEffect")(function* (argv = process.argv.slice(2)) {
  let outputMode = inferErrorOutputMode(argv);
  let fields: readonly string[] = [];

  yield* runMainEffect(
    argv,
    (mode) => {
      outputMode = mode;
    },
    (nextFields) => {
      fields = nextFields;
    },
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        printError(outputMode, renderError(error), fields);
        process.exitCode = 1;
      }),
    ),
  );
});

const runMainEffect: (
  argv: readonly string[],
  setOutputMode: (outputMode: OutputMode) => void,
  setFields: (fields: readonly string[]) => void,
) => Effect.Effect<void, RokitError, FileSystem.FileSystem | Path.Path | Stdio.Stdio> = Effect.fn(
  "runMain",
)(function* (argv, setOutputMode, setFields) {
  if (argv.length === 0) {
    yield* runEffectCliActionEffect(["--help"]);
    return;
  }

  if (isEffectCliActionRequest(argv)) {
    yield* runEffectCliActionEffect(argv);
    return;
  }

  const parsed = yield* parseEffectCliEffect(argv);
  yield* Effect.sync(() => {
    setOutputMode(parsed.outputMode);
    setFields(parsed.fields);
  });

  if (parsed.command === undefined && parsed.inputJson === undefined) {
    yield* runEffectCliActionEffect(["--help"]);
    return;
  }

  const command = yield* parseCommandEffect(parsed);
  const context = yield* loadContextEffect(command, parsed.dryRun);
  const result = yield* runCommandEffect(context, command, parsed.dryRun);

  yield* Effect.sync(() => {
    printResult(parsed.outputMode, result, parsed.fields);
  });
});

const loadContextEffect: (
  command: Command,
  dryRun: boolean,
) => Effect.Effect<RokuContext | undefined, RokitError> = Effect.fn("loadContext")(
  function* (command, dryRun) {
    if (!commandNeedsTarget(command, dryRun)) {
      return undefined;
    }

    return yield* Effect.try({
      try: () => {
        loadLocalEnv();
        const env = loadEnv();
        return {
          password: env.password,
          target: requireTarget(env),
          timeoutMs: env.timeoutMs,
          username: env.username,
        };
      },
      catch: normalizeError,
    });
  },
);

const parseCommandEffect: (
  parsed: ParsedCli,
) => Effect.Effect<Command, RokitError, FileSystem.FileSystem | Stdio.Stdio> = Effect.fn(
  "parseCommand",
)(function* (parsed) {
  if (parsed.inputJson !== undefined && parsed.command !== undefined) {
    return yield* Effect.fail(
      InvalidInput.make({ message: "usage: rokit --input-json <json|@file|->" }),
    );
  }

  if (parsed.inputJson !== undefined) {
    const inputJson = yield* resolveInputJsonSource(parsed.inputJson);
    return yield* parseInputJsonEffect(inputJson);
  }

  if (parsed.command === undefined) {
    return yield* Effect.fail(InvalidInput.make({ message: "No command parsed" }));
  }

  return parsed.command;
});

const isHelpFlag = (arg: string | undefined): boolean => arg === "--help" || arg === "-h";

const isEffectCliActionRequest = (args: readonly string[]): boolean =>
  hasPreTerminatorArg(args, (arg) => isHelpFlag(arg) || arg === "--version");

const hasPreTerminatorArg = (
  args: readonly string[],
  predicate: (arg: string) => boolean,
): boolean => {
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }

    if (predicate(arg)) {
      return true;
    }
  }

  return false;
};
