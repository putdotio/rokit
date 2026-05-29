import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { digestAuthHeaderEffect, parseDigestChallenge } from "./digest-auth.js";
import {
  isDeleteSuccess,
  isEmptyDeveloperSlotMessage,
  isInstallerSuccess,
  normalizeInstallSuccessMessage,
  readInstallerMessage,
} from "./installer-message.js";
import type { RokuContext } from "./roku-context.js";

type InstallerAction = "delete" | "install";
type InstallerSubmitValue = "Delete" | "Install" | "Replace";

const nodeInstallerLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

class RokuInstallerTransportError extends Schema.TaggedErrorClass<RokuInstallerTransportError>()(
  "RokuInstallerTransportError",
  {
    action: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Roku installer ${this.action} request failed: ${this.detail}`;
  }
}

class RokuInstallerHttpError extends Schema.TaggedErrorClass<RokuInstallerHttpError>()(
  "RokuInstallerHttpError",
  {
    action: Schema.String,
    detail: Schema.String,
    status: Schema.Number,
  },
) {
  override get message(): string {
    return `Roku installer ${this.action} failed with HTTP ${this.status}: ${this.detail}`;
  }
}

type InstallerError = RokuInstallerHttpError | RokuInstallerTransportError;

export const installPackageEffect: (
  context: RokuContext & { readonly password: string },
  zipPath: string,
) => Effect.Effect<string, InstallerError, FileSystem.FileSystem | Path.Path> = Effect.fn(
  "installPackage",
)(function* (context: RokuContext & { readonly password: string }, zipPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedZip = withPackageArchiveExtension(path.resolve(zipPath));
  const archive = yield* fs.readFile(resolvedZip).pipe(
    Effect.mapError((error) =>
      RokuInstallerTransportError.make({
        action: "install",
        detail: formatErrorMessage(error),
      }),
    ),
  );
  const fileName = path.basename(resolvedZip);

  return yield* postValidatedInstallPackage(context, archive, fileName, "Replace").pipe(
    Effect.catchTag("RokuInstallerHttpError", (error) =>
      isEmptyDeveloperSlotMessage(error.detail)
        ? postValidatedInstallPackage(context, archive, fileName, "Install")
        : Effect.fail(error),
    ),
  );
});

export const deleteInstalledChannelEffect: (
  context: RokuContext & { readonly password: string },
) => Effect.Effect<string, InstallerError> = Effect.fn("deleteInstalledChannel")(function* (
  context: RokuContext & { readonly password: string },
) {
  const message = yield* postInstallerForm(context, "delete", () => {
    const form = new FormData();
    form.set("mysubmit", "Delete");
    form.set("archive", "");
    return form;
  });

  if (isDeleteSuccess(message)) {
    return message;
  }

  return yield* Effect.fail(
    RokuInstallerHttpError.make({
      action: "delete",
      detail: message,
      status: 200,
    }),
  );
});

export const installPackage = async (
  context: RokuContext & { readonly password: string },
  zipPath: string,
): Promise<string> =>
  await Effect.runPromise(
    Effect.provide(installPackageEffect(context, zipPath), nodeInstallerLayer),
  );

export const deleteInstalledChannel = async (
  context: RokuContext & { readonly password: string },
): Promise<string> =>
  await Effect.runPromise(
    Effect.provide(deleteInstalledChannelEffect(context), nodeInstallerLayer),
  );

const postInstallerForm = Effect.fn("postInstallerForm")(function* (
  context: RokuContext & { readonly password: string },
  action: InstallerAction,
  makeBody: () => FormData,
) {
  const url = installerUrl(context);
  const challenge = yield* readDigestChallenge(context, action, url);
  const authorization = yield* digestAuthHeaderEffect(context, "POST", url.pathname, challenge);
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(url, {
        body: makeBody(),
        headers: {
          Authorization: authorization,
        },
        method: "POST",
        signal: AbortSignal.timeout(installerPostTimeoutMs(context, action)),
      }),
    catch: (error) =>
      RokuInstallerTransportError.make({
        action,
        detail: formatErrorMessage(error),
      }),
  });
  const responseBody = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (error) =>
      RokuInstallerTransportError.make({
        action,
        detail: formatErrorMessage(error),
      }),
  });
  const message = readInstallerMessage(responseBody);

  if (!response.ok) {
    return yield* Effect.fail(
      RokuInstallerHttpError.make({
        action,
        detail: message === "OK" ? fallbackHttpDetail(responseBody, response.statusText) : message,
        status: response.status,
      }),
    );
  }

  return message;
});

const readDigestChallenge = Effect.fn("readDigestChallenge")(function* (
  context: RokuContext,
  action: InstallerAction,
  url: URL,
) {
  const response = yield* Effect.tryPromise({
    try: () => fetch(url, { method: "GET", signal: AbortSignal.timeout(context.timeoutMs) }),
    catch: (error) =>
      RokuInstallerTransportError.make({
        action,
        detail: formatErrorMessage(error),
      }),
  });
  const challenge = parseDigestChallenge(response.headers.get("www-authenticate"));

  if (challenge === undefined) {
    return yield* Effect.fail(
      RokuInstallerTransportError.make({
        action,
        detail: "Roku developer installer did not provide a Digest auth challenge",
      }),
    );
  }

  return challenge;
});

const postInstallPackage = Effect.fn("postInstallPackage")(function* (
  context: RokuContext & { readonly password: string },
  archive: Uint8Array,
  fileName: string,
  submitValue: InstallerSubmitValue,
) {
  return yield* postInstallerForm(context, "install", () => {
    const form = new FormData();
    form.set("mysubmit", submitValue);
    form.set("archive", new Blob([new Uint8Array(archive)], { type: "application/zip" }), fileName);
    return form;
  });
});

const postValidatedInstallPackage = Effect.fn("postValidatedInstallPackage")(function* (
  context: RokuContext & { readonly password: string },
  archive: Uint8Array,
  fileName: string,
  submitValue: InstallerSubmitValue,
) {
  const message = yield* postInstallPackage(context, archive, fileName, submitValue);

  if (isInstallerSuccess(message)) {
    return normalizeInstallSuccessMessage(message);
  }

  return yield* Effect.fail(
    RokuInstallerHttpError.make({
      action: "install",
      detail: message,
      status: 200,
    }),
  );
});

const installerUrl = (context: RokuContext): URL =>
  new URL(`http://${normalizeInstallerHost(context.target)}/plugin_install`);

const normalizeInstallerHost = (target: string): string =>
  target
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const withPackageArchiveExtension = (filePath: string): string =>
  /\.(?:zip|squashfs)$/i.test(filePath) ? filePath : `${filePath}.zip`;

const installerPostTimeoutMs = (context: RokuContext, action: InstallerAction): number =>
  action === "install" ? Math.max(context.timeoutMs, 150_000) : context.timeoutMs;

const fallbackHttpDetail = (body: string, statusText: string): string => {
  const detail = body.trim() || statusText.trim();
  return detail === "" ? "request rejected" : detail.slice(0, 200);
};

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
