import { Effect } from "effect";
import { Argument, Command as EffectCommand, Flag } from "effect/unstable/cli";
import {
  launchParamsFlag,
  nonNegativeIntegerFlagField,
  optionToUndefined,
  positiveIntegerFlagField,
  remoteKeyArgument,
  stringFlagField,
  stringArgumentField,
} from "./cli-argument.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import { optionalNodeConditionFromCliInputEffect } from "./cli-node-condition.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";
import { nodeConditionStates } from "./node-condition.js";

export const controlCommands = (capture: CommandCapture) => [
  strictCommand("launch", {
    appId: stringArgumentField(commandParameter("launch", "app-id")),
    params: launchParamsFlag(commandParameter("launch", "param")),
  }).pipe(
    withCommandDescription(commandDescription("launch")),
    EffectCommand.withHandler(({ appId, params }) =>
      capture({
        args: {
          appId,
          params,
        },
        name: "launch",
      }),
    ),
  ),
  EffectCommand.make("press", {
    delayMs: nonNegativeIntegerFlagField(commandParameter("press", "delay-ms"), "delay").pipe(
      Flag.withDefault(0),
    ),
    keys: remoteKeyArgument(commandParameter("press", "key")).pipe(Argument.variadic({ min: 1 })),
    maxAttempts: positiveIntegerFlagField(commandParameter("press", "max"), "max attempts").pipe(
      Flag.optional,
    ),
    untilNodeName: stringFlagField(commandParameter("press", "until-node")).pipe(Flag.optional),
    untilNodeState: Flag.choice("until-state", nodeConditionStates).pipe(
      Flag.withDescription(commandParameter("press", "until-state").description),
      Flag.optional,
    ),
    untilNodeTimeoutMs: positiveIntegerFlagField(
      commandParameter("press", "until-timeout-ms"),
      "until timeout",
    ).pipe(Flag.optional),
    untilNodeValue: stringFlagField(commandParameter("press", "until-value")).pipe(Flag.optional),
  }).pipe(
    withCommandDescription(commandDescription("press")),
    EffectCommand.withHandler(
      ({
        delayMs,
        keys,
        maxAttempts,
        untilNodeName,
        untilNodeState,
        untilNodeTimeoutMs,
        untilNodeValue,
      }) =>
        optionalNodeConditionFromCliInputEffect({
          commandName: "press --until-node",
          nodeName: untilNodeName,
          state: untilNodeState,
          timeoutMs: untilNodeTimeoutMs,
          value: untilNodeValue,
        }).pipe(
          Effect.flatMap((until) =>
            capture({
              args: {
                delayMs,
                keys,
                maxAttempts: optionToUndefined(maxAttempts) ?? (until === undefined ? 1 : 8),
                until,
              },
              name: "press",
            }),
          ),
        ),
    ),
  ),
];
