import { Effect } from "effect";
import { waitForActiveAppEffect } from "./app-control.js";
import type { Command, CommandResult } from "./cli-types.js";
import { queryMediaPlayerEffect, waitForMediaPlayerStateEffect } from "./media-player-query.js";
import { observeRokitEffect } from "./observation.js";
import type { RokitError } from "./errors.js";
import type { RokuContext } from "./roku-context.js";
import { readSceneGraphFailure, readSceneGraphStatus } from "./scenegraph.js";
import { querySceneGraphEffect, waitForSceneGraphNodeEffect } from "./scenegraph-query.js";

type WaitReadyCommand = Extract<Command, { readonly name: "wait-ready" }>;

export const runWaitReadyCommandEffect: (
  context: RokuContext,
  command: WaitReadyCommand,
) => Effect.Effect<CommandResult, RokitError> = Effect.fn("runWaitReadyCommand")(
  function* (context, command) {
    const data = yield* waitForReadyEffect(context, command);
    const failedObservations = data.sceneGraph.status === "failed" ? ["sceneGraph"] : [];

    return {
      command: command.name,
      data,
      ...(failedObservations.length > 0 ? { failedObservations, partial: true } : undefined),
      message: `ready: active app ${data.activeApp.id}`,
      status: "ok",
    };
  },
);

const waitForReadyEffect = Effect.fn("waitForReady")(function* (
  context: RokuContext,
  command: WaitReadyCommand,
) {
  const activeApp = yield* waitForActiveAppEffect(context, command.appId, command.timeoutMs);
  const sceneGraph = yield* observeRokitEffect(
    querySceneGraphEffect(context, { attempts: 3, requireComplete: true }),
  );

  const node = command.node;
  if (node !== undefined) {
    yield* waitForSceneGraphNodeEffect(
      context,
      node.nodeName,
      node.expectation,
      node.timeoutMs ?? command.timeoutMs,
    );
  }

  const mediaState = command.mediaState;
  const mediaPlayer =
    mediaState !== undefined
      ? {
          data: yield* waitForMediaPlayerStateEffect(context, mediaState, command.timeoutMs),
          status: "ok",
        }
      : yield* observeRokitEffect(queryMediaPlayerEffect(context));

  return {
    activeApp,
    mediaPlayer,
    sceneGraph:
      sceneGraph.status === "ok"
        ? {
            data: {
              failure: readSceneGraphFailure(sceneGraph.data),
              status: readSceneGraphStatus(sceneGraph.data),
            },
            status: "ok",
          }
        : sceneGraph,
  };
});
