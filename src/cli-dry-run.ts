import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import type { Command, CommandResult } from "./cli-types.js";
import { commandSupportsDryRun } from "./cli-command-traits.js";
import { validateRemoteKey } from "./ecp.js";
import { normalizeError, type RokitError } from "./errors.js";
import { formatNodeData } from "./node-condition.js";
import { timestampOutputPath } from "./output-path.js";
import { resolveSafePackageOutputPathEffect } from "./package-zip.js";
import { syncRokit } from "./rokit-effect.js";
import { resolveFileOutputPath, resolveOutputPath } from "./runtime.js";

export const dryRunCommandEffect: (
  command: Command,
) => Effect.Effect<CommandResult | undefined, RokitError, FileSystem.FileSystem | Path.Path> =
  Effect.fn("dryRunCommand")(function* (command) {
    if (!commandSupportsDryRun(command)) {
      return undefined;
    }

    return dryRunResult(command.name, yield* dryRunDataEffect(command));
  });

export const dryRunCommand = async (command: Command): Promise<CommandResult | undefined> =>
  await Effect.runPromise(dryRunCommandEffect(command).pipe(Effect.provide(NodeServices.layer)));

const dryRunResult = (command: string, data: unknown): CommandResult => ({
  command,
  data,
  dryRun: true,
  message: `dry-run: ${command}`,
  status: "ok",
});

const dryRunDataEffect: (
  command: Command,
) => Effect.Effect<unknown, RokitError, FileSystem.FileSystem | Path.Path> = Effect.fn(
  "dryRunData",
)(function* (command) {
  if (!commandSupportsDryRun(command)) {
    return undefined;
  }
  if (command.name === "discover") {
    return { timeoutMs: command.timeoutMs ?? 3_000 };
  }

  if (command.name === "package") {
    const outputPath = yield* syncRokit(() =>
      resolveFileOutputPath(command.outputPath, "package output path"),
    );
    return {
      path: yield* resolveSafePackageOutputPathEffect(outputPath).pipe(
        Effect.mapError(normalizeError),
      ),
    };
  }

  if (command.name === "launch") {
    return { appId: command.args.appId, params: Object.fromEntries(command.args.params) };
  }

  if (command.name === "press") {
    yield* syncRokit(() => {
      for (const key of command.args.keys) {
        validateRemoteKey(key);
      }
    });

    return {
      delayMs: command.args.delayMs,
      keys: command.args.keys,
      maxAttempts: command.args.maxAttempts,
      until: command.args.until ? formatNodeData(command.args.until) : undefined,
    };
  }

  if (command.name === "console") {
    return {
      durationMs: command.args.durationMs,
      path: timestampOutputPath(
        yield* syncRokit(() =>
          resolveFileOutputPath(command.args.outputPath, "console output path"),
        ),
      ),
      port: 8085,
    };
  }

  if (command.name === "debug-command") {
    return {
      args: command.args.command.args,
      command: command.args.command.command,
      durationMs: command.args.durationMs,
      idleTimeoutMs: command.args.idleTimeoutMs,
      port: command.args.command.port,
      request: command.args.command.request.trim(),
    };
  }

  if (command.name === "screenshot") {
    return {
      path: timestampOutputPath(
        yield* syncRokit(() => resolveFileOutputPath(command.outputPath, "screenshot output path")),
      ),
    };
  }

  if (command.name === "proof") {
    return {
      outputDir: yield* syncRokit(() =>
        resolveOutputPath(command.outputDir, "proof output directory"),
      ),
      screenshot: command.screenshot,
    };
  }

  if (command.name === "install") {
    return { zipPath: command.zipPath };
  }

  return {};
});
