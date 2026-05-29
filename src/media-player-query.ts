import { Effect } from "effect";
import { queryEcpEffect } from "./app-control.js";
import {
  readMediaPlayerInfo,
  type MediaPlayerInfo,
  type MediaPlayerState,
} from "./media-player.js";
import { attemptEffect, pollDone, pollPending, pollUntilEffect } from "./polling.js";
import { failRokit } from "./rokit-effect.js";
import type { RokuContext } from "./roku-context.js";

type MediaPlayerPollState = {
  readonly lastError?: string;
  readonly lastState?: string;
};

const defaultPollIntervalMs = 500;

export const queryMediaPlayerXmlEffect = Effect.fn("queryMediaPlayerXml")(function* (
  context: RokuContext,
) {
  return yield* queryEcpEffect(context, "/query/media-player");
});

export const queryMediaPlayerXml = async (context: RokuContext): Promise<string> =>
  await Effect.runPromise(queryMediaPlayerXmlEffect(context));

export const queryMediaPlayerEffect = Effect.fn("queryMediaPlayer")(function* (
  context: RokuContext,
) {
  const xml = yield* queryMediaPlayerXmlEffect(context);
  return readMediaPlayerInfo(xml);
});

export const queryMediaPlayer = async (context: RokuContext): Promise<MediaPlayerInfo> =>
  await Effect.runPromise(queryMediaPlayerEffect(context));

export const queryMediaPlayerXmlSafeEffect = Effect.fn("queryMediaPlayerXmlSafe")(function* (
  context: RokuContext,
) {
  return yield* Effect.match(queryMediaPlayerXmlEffect(context), {
    onFailure: () => undefined,
    onSuccess: (xml) => xml,
  });
});

export const queryMediaPlayerXmlSafe = async (context: RokuContext): Promise<string | undefined> =>
  await Effect.runPromise(queryMediaPlayerXmlSafeEffect(context));

export const queryMediaPlayerSafeEffect = Effect.fn("queryMediaPlayerSafe")(function* (
  context: RokuContext,
) {
  const xml = yield* queryMediaPlayerXmlSafeEffect(context);
  return xml === undefined ? undefined : readMediaPlayerInfo(xml);
});

export const queryMediaPlayerSafe = async (
  context: RokuContext,
): Promise<MediaPlayerInfo | undefined> =>
  await Effect.runPromise(queryMediaPlayerSafeEffect(context));

export const assertMediaPlayerContainerEffect = Effect.fn("assertMediaPlayerContainer")(function* (
  context: RokuContext,
  expectedContainer: string,
) {
  const mediaPlayer = yield* queryMediaPlayerEffect(context);

  if (mediaPlayer.container !== expectedContainer) {
    return yield* failRokit(
      `expected media-player container ${expectedContainer}, got ${mediaPlayer.container ?? "unknown"}`,
    );
  }

  return mediaPlayer;
});

export const assertMediaPlayerContainer = async (
  context: RokuContext,
  expectedContainer: string,
): Promise<MediaPlayerInfo> =>
  await Effect.runPromise(assertMediaPlayerContainerEffect(context, expectedContainer));

export const waitForMediaPlayerStateEffect = Effect.fn("waitForMediaPlayerState")(function* (
  context: RokuContext,
  expectedState: MediaPlayerState,
  timeoutMs = 10_000,
) {
  const initialState: MediaPlayerPollState = {};
  return yield* pollUntilEffect({
    initialState,
    intervalMs: defaultPollIntervalMs,
    poll: (state) =>
      attemptEffect(queryMediaPlayerEffect(context)).pipe(
        Effect.map((result) => {
          if (result.status === "failed") {
            return pollPending({ ...state, lastError: result.error.message });
          }

          if (result.value.state === expectedState) {
            return pollDone(result.value);
          }

          return pollPending({ lastState: result.value.state });
        }),
      ),
    timeout: (state) => {
      const suffix = state.lastError ? `; last ECP error: ${state.lastError}` : "";
      return failRokit(
        `expected media-player state ${expectedState}, got ${state.lastState ?? "unknown"}${suffix}`,
      );
    },
    timeoutMs,
  });
});

export const waitForMediaPlayerState = async (
  context: RokuContext,
  expectedState: MediaPlayerState,
  timeoutMs = 10_000,
): Promise<MediaPlayerInfo> =>
  await Effect.runPromise(waitForMediaPlayerStateEffect(context, expectedState, timeoutMs));
