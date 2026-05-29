import { Effect } from "effect";
import { Argument, Command as EffectCommand, Flag } from "effect/unstable/cli";
import {
  pathArgumentField,
  positiveIntegerFlagField,
  stringArgumentField,
} from "./cli-argument.js";
import {
  defaultConsoleDurationMs,
  defaultDebugCommandDurationMs,
  defaultDebugCommandIdleTimeoutMs,
} from "./cli-defaults.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";
import { buildDebugCommandEffect } from "./debug.js";

export const debugCommands = (capture: CommandCapture) => [
  strictCommand("console", {
    durationMs: positiveIntegerFlagField(
      commandParameter("console", "duration-ms"),
      "duration",
    ).pipe(Flag.withDefault(defaultConsoleDurationMs)),
    outputPath: pathArgumentField(commandParameter("console", "output-path")),
  }).pipe(
    withCommandDescription(commandDescription("console")),
    EffectCommand.withHandler(({ durationMs, outputPath }) =>
      capture({ args: { durationMs, outputPath }, name: "console" }),
    ),
  ),
  EffectCommand.make("debug-command", {
    debugCommand: stringArgumentField(commandParameter("debug-command", "command")),
    debugArgs: stringArgumentField(commandParameter("debug-command", "args")).pipe(
      Argument.variadic(),
    ),
    durationMs: positiveIntegerFlagField(
      commandParameter("debug-command", "duration-ms"),
      "duration",
    ).pipe(Flag.withDefault(defaultDebugCommandDurationMs)),
    idleTimeoutMs: positiveIntegerFlagField(
      commandParameter("debug-command", "idle-timeout-ms"),
      "idle timeout",
    ).pipe(Flag.withDefault(defaultDebugCommandIdleTimeoutMs)),
  }).pipe(
    withCommandDescription(commandDescription("debug-command")),
    EffectCommand.withHandler(({ debugArgs, debugCommand, durationMs, idleTimeoutMs }) =>
      buildDebugCommandEffect(debugCommand, debugArgs).pipe(
        Effect.flatMap((command) =>
          capture({
            args: {
              command,
              durationMs,
              idleTimeoutMs,
            },
            name: "debug-command",
          }),
        ),
      ),
    ),
  ),
];
