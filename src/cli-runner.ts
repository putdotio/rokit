import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import {
  launchAppEffect,
  queryActiveAppEffect,
  queryEcpEffect,
  waitForActiveAppEffect,
} from "./app-control.js";
import {
  formatMediaPlayerMessage,
  observationResult,
  proofBundleResult,
} from "./cli-command-result.js";
import { describeCli } from "./cli-describe.js";
import type { Command, CommandResult } from "./cli-types.js";
import { dryRunCommandEffect } from "./cli-dry-run.js";
import { captureDebugConsoleEffect, runDebugCommandEffect } from "./debug.js";
import { discoverRokuDevicesEffect } from "./discovery.js";
import { writeTextFileEffect } from "./file-output.js";
import { installPackageEffect } from "./installer.js";
import { checkDeviceEffect, getDeviceInfoEffect } from "./device.js";
import { queryMediaPlayerEffect, waitForMediaPlayerStateEffect } from "./media-player-query.js";
import { formatNodeCondition, formatNodeData } from "./node-condition.js";
import { timestampOutputPath } from "./output-path.js";
import { collectSnapshotEffect, writeProofEffect } from "./proof.js";
import { packageChannelEffect } from "./package-zip.js";
import { runPressCommandEffect } from "./cli-press-runner.js";
import { runWaitReadyCommandEffect } from "./cli-ready-runner.js";
import { requirePasswordEffect, requireRokuContextEffect } from "./roku-context-requirements.js";
import {
  assertSceneGraphNodeEffect,
  querySceneGraphEffect,
  waitForSceneGraphNodeEffect,
} from "./scenegraph-query.js";
import { syncRokit } from "./rokit-effect.js";
import { captureScreenshotEffect } from "./screenshot.js";
import type { RokuContext } from "./roku-context.js";
import { resolveFileOutputPath, resolveOutputPath } from "./runtime.js";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";

export const runCommandEffect: (
  context: RokuContext | undefined,
  command: Command,
  dryRun: boolean,
) => Effect.Effect<CommandResult, RokitError, FileSystem.FileSystem | Path.Path> = Effect.fn(
  "runCommand",
)(function* (context, command, dryRun) {
  if (command.name === "describe") {
    const data = describeCli(command.commandName);

    if (data === undefined) {
      return yield* Effect.fail(
        new InvalidInput({ message: `Unknown described command: ${command.commandName ?? ""}` }),
      );
    }

    return { command: command.name, data, status: "ok" };
  }

  if (dryRun) {
    const dryRunResult = yield* dryRunCommandEffect(command);

    if (dryRunResult !== undefined) {
      return dryRunResult;
    }
  }

  if (command.name === "discover") {
    const devices = yield* discoverRokuDevicesEffect(command.timeoutMs);
    return {
      command: command.name,
      data: { devices },
      message:
        devices.length === 0
          ? "no Roku devices discovered"
          : devices.map((device) => `${device.target ?? "unknown"} ${device.location}`).join("\n"),
      status: "ok",
    };
  }

  if (command.name === "package") {
    const outputPath = yield* syncRokit(() =>
      resolveFileOutputPath(command.outputPath, "package output path"),
    );
    const result = yield* packageChannelEffect(outputPath).pipe(Effect.mapError(normalizeError));
    return {
      command: command.name,
      data: result,
      message: `package: ${result.path}`,
      status: "ok",
    };
  }

  const deviceContext = yield* requireRokuContextEffect(context);

  if (command.name === "check") {
    const summary = yield* checkDeviceEffect(deviceContext);
    return {
      command: command.name,
      data: summary,
      message: [
        `device: ${summary.name} (${summary.model})`,
        `ecp: ${summary.ecp}`,
        `developer installer HTTP status: ${summary.installerStatus}`,
      ].join("\n"),
      status: "ok",
    };
  }

  if (command.name === "console") {
    const requestedPath = yield* syncRokit(() =>
      resolveFileOutputPath(command.args.outputPath, "console output path"),
    );
    const path = timestampOutputPath(requestedPath);
    const capture = yield* captureDebugConsoleEffect(deviceContext, command.args.durationMs);
    yield* writeTextFileEffect(path, capture.body).pipe(Effect.mapError(normalizeError));

    return {
      command: command.name,
      data: { ...capture, path },
      message: `console: ${path}`,
      status: "ok",
    };
  }

  if (command.name === "debug-command") {
    const result = yield* runDebugCommandEffect(
      deviceContext,
      command.args.command,
      command.args.durationMs,
      command.args.idleTimeoutMs,
    );

    return {
      command: command.name,
      data: result,
      message: result.body,
      status: "ok",
    };
  }

  if (command.name === "device-info") {
    return {
      command: command.name,
      data: yield* getDeviceInfoEffect(deviceContext),
      status: "ok",
    };
  }

  if (command.name === "active-app") {
    const app = yield* queryActiveAppEffect(deviceContext);
    return {
      command: command.name,
      data: app,
      message: `active app: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "media-player") {
    const mediaPlayer = yield* queryMediaPlayerEffect(deviceContext);
    return {
      command: command.name,
      data: mediaPlayer,
      message: formatMediaPlayerMessage(mediaPlayer),
      status: "ok",
    };
  }

  if (command.name === "wait-media-player") {
    const mediaPlayer = yield* waitForMediaPlayerStateEffect(
      deviceContext,
      command.state,
      command.timeoutMs,
    );
    return {
      command: command.name,
      data: mediaPlayer,
      message: formatMediaPlayerMessage(mediaPlayer),
      status: "ok",
    };
  }

  if (command.name === "wait-active") {
    const app = yield* waitForActiveAppEffect(deviceContext, command.appId, command.timeoutMs);
    return {
      command: command.name,
      data: app,
      message: `active app: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "launch") {
    const app = yield* launchAppEffect(deviceContext, command.args.appId, command.args.params);
    return {
      command: command.name,
      data: app,
      message: `launched: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "press") {
    return yield* runPressCommandEffect(deviceContext, command);
  }

  if (command.name === "query") {
    const body = yield* queryEcpEffect(deviceContext, command.path);
    return {
      command: command.name,
      data: { body, path: command.path },
      message: body,
      status: "ok",
    };
  }

  if (command.name === "sgnodes") {
    const body = yield* querySceneGraphEffect(deviceContext);
    return { command: command.name, data: { body }, message: body, status: "ok" };
  }

  if (command.name === "assert-node") {
    yield* assertSceneGraphNodeEffect(
      deviceContext,
      command.args.nodeName,
      command.args.expectation,
    );
    return {
      command: command.name,
      data: formatNodeData(command.args),
      message: `asserted node: ${formatNodeCondition(command.args)}`,
      status: "ok",
    };
  }

  if (command.name === "wait-node") {
    yield* waitForSceneGraphNodeEffect(
      deviceContext,
      command.args.nodeName,
      command.args.expectation,
      command.args.timeoutMs,
    );
    return {
      command: command.name,
      data: formatNodeData(command.args),
      message: `matched node: ${formatNodeCondition(command.args)}`,
      status: "ok",
    };
  }

  if (command.name === "screenshot") {
    const requestedPath = yield* syncRokit(() =>
      resolveFileOutputPath(command.outputPath, "screenshot output path"),
    );
    const path = timestampOutputPath(requestedPath);

    const password = yield* requirePasswordEffect(deviceContext);
    const screenshotPath = yield* captureScreenshotEffect(
      { ...deviceContext, password },
      path,
    ).pipe(Effect.mapError(normalizeError));
    return {
      command: command.name,
      data: { path: screenshotPath },
      message: `screenshot: ${screenshotPath}`,
      status: "ok",
    };
  }

  if (command.name === "snapshot") {
    const data = yield* collectSnapshotEffect(deviceContext);
    return observationResult(command.name, data);
  }

  if (command.name === "proof") {
    const outputDir = yield* syncRokit(() =>
      resolveOutputPath(command.outputDir, "proof output directory"),
    );

    const data = yield* writeProofEffect(deviceContext, outputDir, command.screenshot).pipe(
      Effect.mapError(normalizeError),
    );
    return proofBundleResult(command.name, data);
  }

  if (command.name === "wait-ready") {
    return yield* runWaitReadyCommandEffect(deviceContext, command);
  }

  if (command.name === "install") {
    const password = yield* requirePasswordEffect(deviceContext);
    const message = yield* installPackageEffect(
      { ...deviceContext, password },
      command.zipPath,
    ).pipe(Effect.mapError(normalizeError));
    return { command: command.name, data: { message }, message, status: "ok" };
  }

  return yield* Effect.fail(new InvalidInput({ message: "unsupported command" }));
});

export const runCommand = async (
  context: RokuContext | undefined,
  command: Command,
  dryRun: boolean,
): Promise<CommandResult> => {
  return await Effect.runPromise(
    runCommandEffect(context, command, dryRun).pipe(Effect.provide(NodeServices.layer)),
  );
};
