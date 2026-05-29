import { Effect } from "effect";
import { Argument, Command as EffectCommand, Flag } from "effect/unstable/cli";
import type { Command } from "./cli-types.js";
import {
  choiceArgumentField,
  optionToUndefined,
  positiveIntegerFlagField,
  stringArgumentField,
  stringFlagField,
} from "./cli-argument.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import {
  nodeConditionFromCliInputEffect,
  optionalNodeConditionFromCliInputEffect,
} from "./cli-node-condition.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";
import { normalizeError } from "./errors.js";
import { nodeConditionStates } from "./node-condition.js";
import { rejectUnsafeEcpPath } from "./runtime.js";

export const observationCommands = (capture: CommandCapture) => [
  noArgumentCommand("check", capture),
  noArgumentCommand("device-info", capture),
  noArgumentCommand("active-app", capture),
  noArgumentCommand("media-player", capture),
  noArgumentCommand("snapshot", capture),
  noArgumentCommand("sgnodes", capture),
  strictCommand("discover", {
    timeoutMs: positiveIntegerFlagField(commandParameter("discover", "timeout-ms"), "timeout").pipe(
      Flag.optional,
    ),
  }).pipe(
    withCommandDescription(commandDescription("discover")),
    EffectCommand.withHandler(({ timeoutMs }) =>
      capture({ name: "discover", timeoutMs: optionToUndefined(timeoutMs) }),
    ),
  ),
  strictCommand("wait-active", {
    appId: stringArgumentField(commandParameter("wait-active", "app-id")),
    timeoutMs: positiveIntegerFlagField(
      commandParameter("wait-active", "timeout-ms"),
      "timeout",
    ).pipe(Flag.optional),
  }).pipe(
    withCommandDescription(commandDescription("wait-active")),
    EffectCommand.withHandler(({ appId, timeoutMs }) =>
      capture({ appId, name: "wait-active", timeoutMs: optionToUndefined(timeoutMs) }),
    ),
  ),
  strictCommand("wait-media-player", {
    state: stringArgumentField(commandParameter("wait-media-player", "state")),
    timeoutMs: positiveIntegerFlagField(
      commandParameter("wait-media-player", "timeout-ms"),
      "timeout",
    ).pipe(Flag.optional),
  }).pipe(
    withCommandDescription(commandDescription("wait-media-player")),
    EffectCommand.withHandler(({ state, timeoutMs }) =>
      capture({
        name: "wait-media-player",
        state,
        timeoutMs: optionToUndefined(timeoutMs),
      }),
    ),
  ),
  strictCommand("wait-ready", {
    appId: stringArgumentField(commandParameter("wait-ready", "app-id")),
    mediaState: stringFlagField(commandParameter("wait-ready", "media-state")).pipe(Flag.optional),
    nodeName: stringArgumentField(commandParameter("wait-ready", "node-name")).pipe(
      Argument.optional,
    ),
    nodeState: choiceArgumentField(
      commandParameter("wait-ready", "condition"),
      nodeConditionStates,
    ).pipe(Argument.optional),
    nodeValue: stringArgumentField(commandParameter("wait-ready", "value")).pipe(Argument.optional),
    nodeTimeoutMs: positiveIntegerFlagField(
      commandParameter("wait-ready", "node-timeout-ms"),
      "node timeout",
    ).pipe(Flag.optional),
    timeoutMs: positiveIntegerFlagField(
      commandParameter("wait-ready", "timeout-ms"),
      "timeout",
    ).pipe(Flag.optional),
  }).pipe(
    withCommandDescription(commandDescription("wait-ready")),
    EffectCommand.withHandler(
      ({ appId, mediaState, nodeName, nodeState, nodeTimeoutMs, nodeValue, timeoutMs }) =>
        optionalNodeConditionFromCliInputEffect({
          commandName: "wait-ready <app-id>",
          nodeName,
          state: nodeState,
          timeoutMs: nodeTimeoutMs,
          value: nodeValue,
        }).pipe(
          Effect.flatMap((node) =>
            capture({
              appId,
              mediaState: optionToUndefined(mediaState),
              name: "wait-ready",
              node,
              timeoutMs: optionToUndefined(timeoutMs),
            }),
          ),
        ),
    ),
  ),
  strictCommand("assert-node", {
    nodeName: stringArgumentField(commandParameter("assert-node", "node-name")),
    condition: choiceArgumentField(
      commandParameter("assert-node", "condition"),
      nodeConditionStates,
    ),
    value: stringArgumentField(commandParameter("assert-node", "value")).pipe(Argument.optional),
  }).pipe(
    withCommandDescription(commandDescription("assert-node")),
    EffectCommand.withHandler(({ condition, nodeName, value }) =>
      nodeConditionFromCliInputEffect({
        commandName: "assert-node",
        condition,
        nodeName,
        value,
      }).pipe(Effect.flatMap((args) => capture({ args, name: "assert-node" }))),
    ),
  ),
  strictCommand("wait-node", {
    nodeName: stringArgumentField(commandParameter("wait-node", "node-name")),
    condition: choiceArgumentField(commandParameter("wait-node", "condition"), nodeConditionStates),
    value: stringArgumentField(commandParameter("wait-node", "value")).pipe(Argument.optional),
    timeoutMs: positiveIntegerFlagField(
      commandParameter("wait-node", "timeout-ms"),
      "timeout",
    ).pipe(Flag.optional),
  }).pipe(
    withCommandDescription(commandDescription("wait-node")),
    EffectCommand.withHandler(({ condition, nodeName, timeoutMs, value }) =>
      nodeConditionFromCliInputEffect({
        commandName: "wait-node",
        condition,
        nodeName,
        value,
      }).pipe(
        Effect.flatMap((args) =>
          capture({
            args: {
              ...args,
              timeoutMs: optionToUndefined(timeoutMs),
            },
            name: "wait-node",
          }),
        ),
      ),
    ),
  ),
  strictCommand("query", {
    path: stringArgumentField(commandParameter("query", "ecp-path")),
  }).pipe(
    withCommandDescription(commandDescription("query")),
    EffectCommand.withHandler(({ path }) =>
      Effect.try({
        try: () => {
          rejectUnsafeEcpPath(path);
        },
        catch: normalizeError,
      }).pipe(Effect.andThen(capture({ name: "query", path }))),
    ),
  ),
];

type NoArgumentCommandName = Extract<
  Command["name"],
  "active-app" | "check" | "device-info" | "media-player" | "sgnodes" | "snapshot"
>;

const noArgumentCommand = (name: NoArgumentCommandName, capture: CommandCapture) =>
  strictCommand(name, {}).pipe(
    withCommandDescription(commandDescription(name)),
    EffectCommand.withHandler(() => capture({ name })),
  );
