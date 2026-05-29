import { Effect } from "effect";
import type { Command, CommandResult } from "./cli-types.js";
import { pressKeyEffect } from "./app-control.js";
import { formatNodeData } from "./node-condition.js";
import type { RokitError } from "./errors.js";
import type { RokuContext } from "./roku-context.js";
import { assertSceneGraphNodeEffect, waitForSceneGraphNodeEffect } from "./scenegraph-query.js";
import { sleepEffect } from "./timing.js";

type PressCommand = Extract<Command, { readonly name: "press" }>;

export const runPressCommandEffect: (
  context: RokuContext,
  command: PressCommand,
) => Effect.Effect<CommandResult, RokitError> = Effect.fn("runPressCommand")(
  function* (context, command) {
    const pressed: string[] = [];
    let attempts = 0;

    while (attempts < command.args.maxAttempts) {
      attempts += 1;

      for (const [index, key] of command.args.keys.entries()) {
        if ((index > 0 || attempts > 1) && command.args.delayMs > 0) {
          yield* sleepEffect(command.args.delayMs);
        }

        yield* pressKeyEffect(context, key);
        pressed.push(key);
      }

      const until = command.args.until;
      if (until === undefined) {
        break;
      }

      const assertion =
        until.timeoutMs === undefined
          ? assertSceneGraphNodeEffect(context, until.nodeName, until.expectation)
          : waitForSceneGraphNodeEffect(
              context,
              until.nodeName,
              until.expectation,
              until.timeoutMs,
            );

      const assertionPassed = yield* assertion.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            attempts >= command.args.maxAttempts ? Effect.fail(error) : Effect.succeed(false),
          onSuccess: () => Effect.succeed(true),
        }),
      );

      if (assertionPassed) {
        break;
      }
    }

    return {
      command: command.name,
      data: {
        attempts,
        delayMs: command.args.delayMs,
        keys: pressed,
        until: command.args.until ? formatNodeData(command.args.until) : undefined,
      },
      message: pressed.map((key) => `pressed: ${key}`).join("\n"),
      status: "ok",
    };
  },
);
