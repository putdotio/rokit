import { Effect, Schema } from "effect";
import { readResponseTextEffect } from "./response-body.js";
import type { RokuContext } from "./roku-context.js";
import { abortSignalWithTimeout } from "./timing.js";

export const ecpPort = 8060;

const remoteKeys = [
  "Home",
  "Rev",
  "Fwd",
  "Play",
  "Select",
  "Left",
  "Right",
  "Down",
  "Up",
  "Back",
  "InstantReplay",
  "Info",
  "Backspace",
  "Search",
  "Enter",
  "VolumeDown",
  "VolumeMute",
  "VolumeUp",
  "PowerOff",
  "ChannelUp",
  "ChannelDown",
  "InputTuner",
  "InputHDMI1",
  "InputHDMI2",
  "InputHDMI3",
  "InputHDMI4",
] as const;

const remoteKeySet: ReadonlySet<string> = new Set(remoteKeys);

export type RemoteKey = (typeof remoteKeys)[number] | `Lit_${string}`;

class EcpTransportError extends Schema.TaggedError<EcpTransportError>()("EcpTransportError", {
  detail: Schema.String,
  method: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return `${this.method} ${this.path} failed: ${this.detail}`;
  }
}

class EcpHttpError extends Schema.TaggedError<EcpHttpError>()("EcpHttpError", {
  method: Schema.String,
  path: Schema.String,
  status: Schema.Number,
}) {
  override get message(): string {
    return `${this.method} ${this.path} returned HTTP ${this.status}`;
  }
}

class EcpPathError extends Schema.TaggedError<EcpPathError>()("EcpPathError", {
  detail: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export type EcpError = EcpHttpError | EcpPathError | EcpTransportError;

export const fetchEcpTextEffect = Effect.fn("fetchEcpText")(function* (
  context: RokuContext,
  path: string,
) {
  const safePath = yield* safeDeviceRelativePath(path);
  const url = ecpUrl(context, safePath);
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal: abortSignalWithTimeout(signal, context.timeoutMs) }),
    catch: (error) =>
      new EcpTransportError({ detail: formatErrorMessage(error), method: "GET", path: safePath }),
  });

  if (!response.ok) {
    return yield* Effect.fail(
      new EcpHttpError({ method: "GET", path: safePath, status: response.status }),
    );
  }

  return yield* readResponseTextEffect(
    response,
    (error) =>
      new EcpTransportError({ detail: formatErrorMessage(error), method: "GET", path: safePath }),
  );
});

export const postEcpEffect = Effect.fn("postEcp")(function* (context: RokuContext, path: string) {
  const safePath = yield* safeDeviceRelativePath(path);
  yield* postEcpUrlEffect(context, ecpUrl(context, safePath), safePath);
});

const postEcpUrlEffect = Effect.fn("postEcpUrl")(function* (
  context: RokuContext,
  url: URL,
  path: string,
) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        method: "POST",
        signal: abortSignalWithTimeout(signal, context.timeoutMs),
      }),
    catch: (error) =>
      new EcpTransportError({ detail: formatErrorMessage(error), method: "POST", path }),
  });

  if (!response.ok) {
    return yield* Effect.fail(new EcpHttpError({ method: "POST", path, status: response.status }));
  }
});

export const postKeypressEffect = Effect.fn("postKeypress")(function* (
  context: RokuContext,
  key: string,
) {
  const remoteKey = yield* remoteKeyEffect(key);
  const path = `/keypress/${encodeURIComponent(remoteKey)}`;
  yield* postEcpUrlEffect(context, ecpUrl(context, path), path);
});

export const postLaunchEffect = Effect.fn("postLaunch")(function* (context: RokuContext, url: URL) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        method: "POST",
        signal: abortSignalWithTimeout(signal, context.timeoutMs),
      }),
    catch: (error) =>
      new EcpTransportError({
        detail: formatErrorMessage(error),
        method: "POST",
        path: url.pathname,
      }),
  }).pipe(
    Effect.catchTag("EcpTransportError", (error) =>
      isIgnoredLaunchTransportError(error.detail.toLowerCase())
        ? Effect.succeed(undefined)
        : Effect.fail(error),
    ),
  );

  if (response === undefined || response.ok || response.status === 503) {
    return;
  }

  return yield* Effect.fail(
    new EcpHttpError({ method: "POST", path: url.pathname, status: response.status }),
  );
});

export const fetchEcpText = async (context: RokuContext, path: string): Promise<string> =>
  await Effect.runPromise(fetchEcpTextEffect(context, path));

export const postEcp = async (context: RokuContext, path: string): Promise<void> => {
  await Effect.runPromise(postEcpEffect(context, path));
};

export const postKeypress = async (context: RokuContext, key: string): Promise<void> => {
  await Effect.runPromise(postKeypressEffect(context, key));
};

export const postLaunch = async (context: RokuContext, url: URL): Promise<void> => {
  await Effect.runPromise(postLaunchEffect(context, url));
};

export const ecpUrl = (context: RokuContext, path: string): URL =>
  new URL(path, `http://${context.target}:${ecpPort}`);

const safeDeviceRelativePath = (path: string): Effect.Effect<string, EcpPathError> =>
  Effect.try({
    try: () => {
      const safePath = validateEcpPath(path);
      return safePath.startsWith("/") ? safePath : `/${safePath}`;
    },
    catch: (error) => new EcpPathError({ detail: formatErrorMessage(error), path }),
  });

const remoteKeyEffect = (key: string): Effect.Effect<string, EcpPathError> =>
  Effect.try({
    try: () => {
      validateRemoteKey(key);
      return key;
    },
    catch: (error) =>
      new EcpPathError({ detail: formatErrorMessage(error), path: `/keypress/${key}` }),
  });

export const validateEcpPath = (path: string): string => {
  rejectUnsafeInput(path, "ECP path");

  if (path.includes("\\")) {
    throw new Error("ECP path must not include backslashes");
  }

  if (path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("ECP path must be device-relative");
  }

  if (path.includes("?") || path.includes("#")) {
    throw new Error("ECP path must not include query strings or fragments");
  }

  if (/(^|[/\\])\.\.($|[/\\])/.test(path)) {
    throw new Error("ECP path must not include path traversal");
  }

  if (/%(?:2e|2f|5c)/i.test(path)) {
    throw new Error("ECP path must not include percent-encoded path segments");
  }

  return path;
};

export const validateRemoteKey = (key: string): void => {
  if (key.startsWith("Lit_")) {
    return;
  }

  if (!remoteKeySet.has(key)) {
    throw new Error(`unsupported remote key: ${key}`);
  }
};

const rejectUnsafeInput = (value: string, label: string): void => {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`${label} contains control characters`);
  }
};

const isIgnoredLaunchTransportError = (detail: string): boolean =>
  detail.includes("abort") || detail.includes("timeout") || detail.includes("fetch failed");

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
