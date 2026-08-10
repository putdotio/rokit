import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { digestAuthHeaderEffect, parseDigestChallenge } from "./digest-auth.js";
import type { RokuContext } from "./roku-context.js";
import { abortSignalWithTimeout } from "./timing.js";

export type ScreenshotCaptureOptions = {
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly tempDirPrefix?: string;
};

class ScreenshotCaptureError extends Schema.TaggedError<ScreenshotCaptureError>()(
  "ScreenshotCaptureError",
  {
    detail: Schema.String,
    outputPath: Schema.String,
  },
) {
  override get message(): string {
    return `failed to capture ${this.outputPath}: ${this.detail}`;
  }
}

const nodeScreenshotLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export const takeScreenshotEffect: (
  context: RokuContext & { readonly password: string },
  outputPath: string,
) => Effect.Effect<
  string,
  PlatformError | ScreenshotCaptureError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn("takeScreenshot")(function* (
  context: RokuContext & { readonly password: string },
  outputPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedOutput = path.resolve(outputPath);
  const extension = path.extname(resolvedOutput);
  const baseOutputPath = path.join(
    path.dirname(resolvedOutput),
    path.basename(resolvedOutput, extension),
  );
  const screenshot = yield* createScreenshotOnDeviceEffect(context);
  const outputWithDeviceExtension = `${baseOutputPath}${screenshot.extension}`;
  const image = yield* fetchScreenshotImageEffect(context, screenshot.url);

  yield* fs.makeDirectory(path.dirname(outputWithDeviceExtension), { recursive: true });
  yield* fs.writeFile(outputWithDeviceExtension, image).pipe(
    Effect.mapError(
      (error) =>
        new ScreenshotCaptureError({
          detail: formatErrorMessage(error),
          outputPath: path.basename(outputWithDeviceExtension),
        }),
    ),
  );

  return outputWithDeviceExtension;
});

type CreatedScreenshot = {
  readonly extension: ".jpg" | ".png";
  readonly url: URL;
};

const createScreenshotOnDeviceEffect = Effect.fn("createScreenshotOnDevice")(function* (
  context: RokuContext & { readonly password: string },
) {
  const url = screenshotInspectUrl(context);
  const responseBody = yield* postPluginInspectFormEffect(context, url, () => {
    const form = new FormData();
    form.set("mysubmit", "Screenshot");
    form.set("archive", "");
    return form;
  });

  const screenshot = readScreenshotUrl(url, responseBody);
  if (screenshot !== undefined) {
    return screenshot;
  }

  return yield* Effect.fail(
    new ScreenshotCaptureError({
      detail: "Roku did not return a screenshot URL",
      outputPath: "screenshot",
    }),
  );
});

const postPluginInspectFormEffect = Effect.fn("postPluginInspectForm")(function* (
  context: RokuContext & { readonly password: string },
  url: URL,
  makeBody: () => FormData,
) {
  const challenge = yield* readScreenshotDigestChallengeEffect(context, url);
  const authorization = yield* digestAuthHeaderEffect(context, "POST", url.pathname, challenge);
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        body: makeBody(),
        headers: {
          Authorization: authorization,
        },
        method: "POST",
        signal: abortSignalWithTimeout(signal, context.timeoutMs),
      }),
    catch: (error) =>
      new ScreenshotCaptureError({
        detail: formatErrorMessage(error),
        outputPath: "screenshot",
      }),
  });

  return yield* readScreenshotResponseTextEffect(response, "screenshot");
});

const fetchScreenshotImageEffect = Effect.fn("fetchScreenshotImage")(function* (
  context: RokuContext & { readonly password: string },
  url: URL,
) {
  const firstResponse = yield* fetchScreenshotImageRequestEffect(url, undefined, context.timeoutMs);
  const response =
    firstResponse.status === 401
      ? yield* fetchAuthorizedScreenshotImageEffect(context, url, firstResponse)
      : firstResponse;

  if (!response.ok) {
    return yield* Effect.fail(
      new ScreenshotCaptureError({
        detail: `image request failed with HTTP ${response.status}`,
        outputPath: url.pathname,
      }),
    );
  }

  return yield* Effect.tryPromise({
    try: async () => new Uint8Array(await response.arrayBuffer()),
    catch: (error) =>
      new ScreenshotCaptureError({
        detail: formatErrorMessage(error),
        outputPath: url.pathname,
      }),
  });
});

const fetchAuthorizedScreenshotImageEffect = Effect.fn("fetchAuthorizedScreenshotImage")(function* (
  context: RokuContext & { readonly password: string },
  url: URL,
  challengeResponse: Response,
) {
  const challenge = parseDigestChallenge(challengeResponse.headers.get("www-authenticate"));
  if (challenge === undefined) {
    return yield* Effect.fail(
      new ScreenshotCaptureError({
        detail: "Roku screenshot image did not provide a Digest auth challenge",
        outputPath: url.pathname,
      }),
    );
  }

  const authorization = yield* digestAuthHeaderEffect(context, "GET", digestUri(url), challenge);
  return yield* fetchScreenshotImageRequestEffect(url, authorization, context.timeoutMs);
});

const fetchScreenshotImageRequestEffect = Effect.fn("fetchScreenshotImageRequest")(function* (
  url: URL,
  authorization: string | undefined,
  timeoutMs: number,
) {
  return yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        headers: authorization === undefined ? undefined : { Authorization: authorization },
        signal: abortSignalWithTimeout(signal, timeoutMs),
      }),
    catch: (error) =>
      new ScreenshotCaptureError({
        detail: formatErrorMessage(error),
        outputPath: url.pathname,
      }),
  });
});

const readScreenshotDigestChallengeEffect = Effect.fn("readScreenshotDigestChallenge")(function* (
  context: RokuContext,
  url: URL,
) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        method: "GET",
        signal: abortSignalWithTimeout(signal, context.timeoutMs),
      }),
    catch: (error) =>
      new ScreenshotCaptureError({
        detail: formatErrorMessage(error),
        outputPath: "screenshot",
      }),
  });
  const challenge = parseDigestChallenge(response.headers.get("www-authenticate"));

  if (challenge === undefined) {
    return yield* Effect.fail(
      new ScreenshotCaptureError({
        detail: "Roku developer inspector did not provide a Digest auth challenge",
        outputPath: "screenshot",
      }),
    );
  }

  return challenge;
});

const readScreenshotResponseTextEffect = Effect.fn("readScreenshotResponseText")(function* (
  response: Response,
  outputPath: string,
) {
  const body = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (error) =>
      new ScreenshotCaptureError({
        detail: formatErrorMessage(error),
        outputPath,
      }),
  });

  if (!response.ok) {
    return yield* Effect.fail(
      new ScreenshotCaptureError({
        detail: `HTTP ${response.status}: ${body.trim() || response.statusText}`,
        outputPath,
      }),
    );
  }

  return body;
});

const readScreenshotUrl = (inspectUrl: URL, body: string): CreatedScreenshot | undefined => {
  const match = /["'](pkgs\/dev(\.jpg|\.png)\?[^"']+)["']/i.exec(body);
  const path = match?.[1]?.replace(/&amp;/g, "&");
  const extension = match?.[2]?.toLowerCase();

  if (path === undefined || (extension !== ".jpg" && extension !== ".png")) {
    return undefined;
  }

  return {
    extension,
    url: new URL(path, inspectUrl),
  };
};

const screenshotInspectUrl = (context: RokuContext): URL =>
  new URL(`http://${normalizeScreenshotHost(context.target)}/plugin_inspect`);

const normalizeScreenshotHost = (target: string): string =>
  target
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const digestUri = (url: URL): string => `${url.pathname}${url.search}`;

export const captureScreenshotEffect: (
  context: RokuContext & { readonly password: string },
  outputPath: string,
  options?: ScreenshotCaptureOptions,
) => Effect.Effect<
  string,
  PlatformError | ScreenshotCaptureError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn("captureScreenshot")(function* (
  context: RokuContext & { readonly password: string },
  outputPath: string,
  options: ScreenshotCaptureOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const resolvedOutput = path.resolve(outputPath);
  const outputFileName = path.basename(resolvedOutput);
  yield* fs.makeDirectory(path.dirname(resolvedOutput), { recursive: true });

  let lastError = "unknown";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const captured = yield* Effect.scoped(
      Effect.gen(function* () {
        const captureDir = yield* fs.makeTempDirectoryScoped({
          prefix: safeTempPrefix(options.tempDirPrefix ?? "rokit-screenshot"),
        });
        const capturePath = path.join(captureDir, outputFileName);

        const capturedPath = yield* takeScreenshotEffect(context, capturePath);
        const tempResult = yield* firstExistingPath([capturedPath, capturePath]);
        if (tempResult !== undefined) {
          yield* fs.copyFile(tempResult, resolvedOutput);
          return resolvedOutput;
        }

        const directCapturedPath = yield* takeScreenshotEffect(context, resolvedOutput);
        const directResult = yield* firstExistingPath([resolvedOutput, directCapturedPath]);
        if (directResult === resolvedOutput) {
          return resolvedOutput;
        }

        if (directResult !== undefined) {
          yield* fs.copyFile(directResult, resolvedOutput);
          return resolvedOutput;
        }

        return yield* Effect.fail(
          new ScreenshotCaptureError({
            detail: "screenshot capture succeeded without writing an image file",
            outputPath: outputFileName,
          }),
        );
      }),
    ).pipe(
      Effect.catchTag("ScreenshotCaptureError", (error) => {
        lastError = error.detail;
        return Effect.succeed(undefined);
      }),
    );

    if (captured !== undefined) {
      return captured;
    }

    if (attempt < attempts) {
      yield* Effect.sleep(retryDelayMs);
    }
  }

  return yield* Effect.fail(
    new ScreenshotCaptureError({
      detail: lastError,
      outputPath: outputFileName,
    }),
  );
});

export const takeScreenshot = async (
  context: RokuContext & { readonly password: string },
  outputPath: string,
): Promise<string> =>
  await Effect.runPromise(
    Effect.provide(takeScreenshotEffect(context, outputPath), nodeScreenshotLayer),
  );

export const captureScreenshot = async (
  context: RokuContext & { readonly password: string },
  outputPath: string,
  options: ScreenshotCaptureOptions = {},
): Promise<string> =>
  await Effect.runPromise(
    Effect.provide(captureScreenshotEffect(context, outputPath, options), nodeScreenshotLayer),
  );

const firstExistingPath: (
  paths: readonly string[],
) => Effect.Effect<string | undefined, PlatformError, FileSystem.FileSystem> = Effect.fn(
  "firstExistingPath",
)(function* (paths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;

  for (const path of paths) {
    if (yield* fs.exists(path)) {
      return path;
    }
  }

  return undefined;
});

const safeTempPrefix = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-");

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
