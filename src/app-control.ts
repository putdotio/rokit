import { Effect } from "effect";
import {
  ecpUrl,
  fetchEcpTextEffect,
  postKeypressEffect,
  postLaunchEffect,
  validateEcpPath,
} from "./ecp.js";
import { normalizeError } from "./errors.js";
import { attemptEffect, pollDone, pollPending, pollUntilEffect } from "./polling.js";
import { failRokit, syncRokit } from "./rokit-effect.js";
import type { RokuContext } from "./roku-context.js";
import { readActiveApp, type ActiveApp } from "./xml.js";

type ActiveAppPollState = {
  readonly lastApp?: ActiveApp;
  readonly lastError?: string;
};

const defaultPollIntervalMs = 500;

export const queryActiveAppEffect = Effect.fn("queryActiveApp")(function* (context: RokuContext) {
  const xml = yield* fetchEcpTextEffect(context, "/query/active-app").pipe(
    Effect.mapError(normalizeError),
  );
  return yield* syncRokit(() => readActiveApp(xml));
});

export const queryActiveApp = async (context: RokuContext): Promise<ActiveApp> =>
  await Effect.runPromise(queryActiveAppEffect(context));

export const waitForActiveAppEffect = Effect.fn("waitForActiveApp")(function* (
  context: RokuContext,
  appId: string,
  timeoutMs = 10_000,
) {
  const initialState: ActiveAppPollState = {};
  return yield* pollUntilEffect({
    initialState,
    intervalMs: defaultPollIntervalMs,
    poll: (state) =>
      attemptEffect(queryActiveAppEffect(context)).pipe(
        Effect.map((activeApp) => {
          if (activeApp.status === "failed") {
            return pollPending({ ...state, lastError: activeApp.error.message });
          }

          if (activeApp.value.id === appId) {
            return pollDone(activeApp.value);
          }

          return pollPending({ lastApp: activeApp.value });
        }),
      ),
    timeout: (state) => {
      const last = state.lastApp ? `${state.lastApp.id} ${state.lastApp.name}` : "unknown";
      const errorSuffix = state.lastError ? `; last ECP error: ${state.lastError}` : "";
      return failRokit(`expected active app ${appId}, got ${last}${errorSuffix}`);
    },
    timeoutMs,
  });
});

export const waitForActiveApp = async (
  context: RokuContext,
  appId: string,
  timeoutMs = 10_000,
): Promise<ActiveApp> => await Effect.runPromise(waitForActiveAppEffect(context, appId, timeoutMs));

export const launchAppEffect = Effect.fn("launchApp")(function* (
  context: RokuContext,
  appId: string,
  params: ReadonlyMap<string, string> = new Map(),
) {
  const url = ecpUrl(context, `/launch/${encodeURIComponent(appId)}`);

  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }

  yield* postLaunchEffect(context, url).pipe(Effect.mapError(normalizeError));
  return yield* waitForActiveAppEffect(context, appId);
});

export const launchApp = async (
  context: RokuContext,
  appId: string,
  params: ReadonlyMap<string, string> = new Map(),
): Promise<ActiveApp> => await Effect.runPromise(launchAppEffect(context, appId, params));

export const pressKeyEffect = Effect.fn("pressKey")(function* (context: RokuContext, key: string) {
  yield* postKeypressEffect(context, key).pipe(Effect.mapError(normalizeError));
});

export const pressKey = async (context: RokuContext, key: string): Promise<void> => {
  await Effect.runPromise(pressKeyEffect(context, key));
};

export const queryEcpEffect = Effect.fn("queryEcp")(function* (context: RokuContext, path: string) {
  const safePath = yield* syncRokit(() => validateEcpPath(path));
  return yield* fetchEcpTextEffect(
    context,
    safePath.startsWith("/") ? safePath : `/${safePath}`,
  ).pipe(Effect.mapError(normalizeError));
});

export const queryEcp = async (context: RokuContext, path: string): Promise<string> =>
  await Effect.runPromise(queryEcpEffect(context, path));
