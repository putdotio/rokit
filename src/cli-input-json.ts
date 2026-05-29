import { Effect } from "effect";
import {
  defaultConsoleDurationMs,
  defaultDebugCommandDurationMs,
  defaultDebugCommandIdleTimeoutMs,
} from "./cli-defaults.js";
import { commandNames } from "./cli-command-metadata.js";
import type { Command } from "./cli-types.js";
import {
  parseJsonRecordEffect,
  readNodeExpectationEffect,
  readOptionalBooleanEffect,
  readOptionalNodeConditionEffect,
  readOptionalNonNegativeNumberEffect,
  readOptionalNumberEffect,
  readOptionalStringArrayEffect,
  readOptionalStringEffect,
  readStringArrayEffect,
  readStringEffect,
  readStringMapEffect,
} from "./cli-input-json-read.js";
import { buildDebugCommandEffect } from "./debug.js";
import type { RokitError } from "./errors.js";
import { failRokit, syncRokit } from "./rokit-effect.js";
import { rejectUnsafeEcpPath } from "./runtime.js";

export const inputJsonCommandNames: readonly string[] = commandNames;

export const parseInputJsonEffect: (value: string) => Effect.Effect<Command, RokitError> =
  Effect.fn("parseInputJson")(function* (value) {
    const parsed = yield* parseJsonRecordEffect(value);
    const command = yield* readStringEffect(parsed, "command");

    if (command === "describe") {
      return {
        commandName: yield* readOptionalStringEffect(parsed, "commandName"),
        name: "describe",
      };
    }

    if (command === "discover") {
      return { name: "discover", timeoutMs: yield* readOptionalNumberEffect(parsed, "timeoutMs") };
    }

    if (command === "check" || command === "device-info" || command === "active-app") {
      return { name: command };
    }

    if (command === "console") {
      return {
        args: {
          durationMs:
            (yield* readOptionalNumberEffect(parsed, "durationMs")) ?? defaultConsoleDurationMs,
          outputPath: yield* readStringEffect(parsed, "outputPath"),
        },
        name: "console",
      };
    }

    if (command === "debug-command") {
      const debugCommand = yield* readStringEffect(parsed, "debugCommand");
      const debugArgs = (yield* readOptionalStringArrayEffect(parsed, "args")) ?? [];

      return {
        args: {
          command: yield* buildDebugCommandEffect(debugCommand, debugArgs),
          durationMs:
            (yield* readOptionalNumberEffect(parsed, "durationMs")) ??
            defaultDebugCommandDurationMs,
          idleTimeoutMs:
            (yield* readOptionalNumberEffect(parsed, "idleTimeoutMs")) ??
            defaultDebugCommandIdleTimeoutMs,
        },
        name: "debug-command",
      };
    }

    if (command === "media-player" || command === "sgnodes" || command === "snapshot") {
      return { name: command };
    }

    if (command === "wait-active") {
      return {
        appId: yield* readStringEffect(parsed, "appId"),
        name: "wait-active",
        timeoutMs: yield* readOptionalNumberEffect(parsed, "timeoutMs"),
      };
    }

    if (command === "wait-media-player") {
      return {
        name: "wait-media-player",
        state: yield* readStringEffect(parsed, "state"),
        timeoutMs: yield* readOptionalNumberEffect(parsed, "timeoutMs"),
      };
    }

    if (command === "wait-ready") {
      return {
        appId: yield* readStringEffect(parsed, "appId"),
        mediaState: yield* readOptionalStringEffect(parsed, "mediaState"),
        name: "wait-ready",
        node: yield* readOptionalNodeConditionEffect(parsed, "node"),
        timeoutMs: yield* readOptionalNumberEffect(parsed, "timeoutMs"),
      };
    }

    if (command === "launch") {
      return {
        args: {
          appId: yield* readStringEffect(parsed, "appId"),
          params: yield* readStringMapEffect(parsed, "params"),
        },
        name: "launch",
      };
    }

    if (command === "press") {
      const keys = yield* readStringArrayEffect(parsed, "keys");
      const until = yield* readOptionalNodeConditionEffect(parsed, "until");

      if (keys.length === 0) {
        yield* failRokit("input JSON field must include at least one key: keys");
      }

      return {
        args: {
          delayMs: (yield* readOptionalNonNegativeNumberEffect(parsed, "delayMs")) ?? 0,
          keys,
          maxAttempts:
            (yield* readOptionalNumberEffect(parsed, "maxAttempts")) ??
            (until === undefined ? 1 : 8),
          until,
        },
        name: "press",
      };
    }

    if (command === "query") {
      const path = yield* readStringEffect(parsed, "path");
      yield* syncRokit(() => rejectUnsafeEcpPath(path));
      return { name: "query", path };
    }

    if (command === "assert-node" || command === "wait-node") {
      return {
        args: {
          expectation: yield* readNodeExpectationEffect(parsed),
          nodeName: yield* readStringEffect(parsed, "nodeName"),
          timeoutMs: yield* readOptionalNumberEffect(parsed, "timeoutMs"),
        },
        name: command,
      };
    }

    if (command === "screenshot") {
      return { name: "screenshot", outputPath: yield* readStringEffect(parsed, "outputPath") };
    }

    if (command === "proof") {
      return {
        name: "proof",
        outputDir: yield* readStringEffect(parsed, "outputDir"),
        screenshot: (yield* readOptionalBooleanEffect(parsed, "screenshot")) ?? false,
      };
    }

    if (command === "package") {
      return { name: "package", outputPath: yield* readStringEffect(parsed, "outputPath") };
    }

    if (command === "install") {
      return { name: "install", zipPath: yield* readStringEffect(parsed, "zipPath") };
    }

    return yield* failRokit(`Unknown command: ${command}`);
  });

export const parseInputJson = (value: string): Command =>
  Effect.runSync(parseInputJsonEffect(value));
