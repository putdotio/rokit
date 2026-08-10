import { createConnection } from "node:net";
import { Clock, Effect } from "effect";
import { DebugPortUnavailable, normalizeError, type RokitError } from "./errors.js";
import { fail, formatErrorMessage, rejectUnsafeInput } from "./runtime.js";
import type { RokuContext } from "./roku-context.js";

export type RokuDebugPort = 8080 | 8085;

export type RokuDebugCommand = {
  readonly args: readonly string[];
  readonly command: string;
  readonly port: RokuDebugPort;
  readonly request: string;
};

export type DebugCommandResult = {
  readonly args: readonly string[];
  readonly body: string;
  readonly bytes: number;
  readonly command: string;
  readonly elapsedMs: number;
  readonly port: number;
};

export type DebugConsoleCapture = {
  readonly body: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly port: number;
};

type DebugSocketReadOptions = {
  readonly durationMs: number;
  readonly idleTimeoutMs?: number;
  readonly request?: string;
};

const debugServerPort: RokuDebugPort = 8080;
const brightScriptConsolePort: RokuDebugPort = 8085;

export const buildDebugCommand = (command: string, args: readonly string[]): RokuDebugCommand => {
  validateDebugToken(command, "debug command");

  for (const arg of args) {
    rejectUnsafeInput(arg, "debug command argument");
  }

  if (command === "chanperf") {
    validateChanperfArgs(args);
    return debugServerCommand(command, args);
  }

  if (command === "brightscript_warnings") {
    validateOptionalNonNegativeInteger(args, "brightscript_warnings");
    return debugServerCommand(command, args);
  }

  if (command === "free" || command === "loaded_textures" || command === "r2d2_bitmaps") {
    validateNoArgs(command, args);
    return debugServerCommand(command, args);
  }

  if (command === "sgnodes") {
    return debugServerCommand(command, normalizeSceneGraphNodeArgs(args));
  }

  if (
    command === "bsc" ||
    command === "bscs" ||
    command === "bt" ||
    command === "classes" ||
    command === "help" ||
    command === "last" ||
    command === "list"
  ) {
    validateNoArgs(command, args);
    return brightScriptConsoleCommand(command, args);
  }

  if (command === "threads" || command === "ths") {
    validateOptionalNonNegativeInteger(args, command);
    return brightScriptConsoleCommand(command, args);
  }

  return fail(`Unsupported Roku debug command: ${command}`);
};

export const buildDebugCommandEffect: (
  command: string,
  args: readonly string[],
) => Effect.Effect<RokuDebugCommand, RokitError> = Effect.fn("buildDebugCommand")(
  function* (command, args) {
    return yield* Effect.try({
      catch: normalizeError,
      try: () => buildDebugCommand(command, args),
    });
  },
);

export const runDebugCommandEffect: (
  context: RokuContext,
  command: RokuDebugCommand,
  durationMs: number,
  idleTimeoutMs: number,
) => Effect.Effect<DebugCommandResult, RokitError> = Effect.fn("runDebugCommand")(function* (
  context: RokuContext,
  command: RokuDebugCommand,
  durationMs: number,
  idleTimeoutMs: number,
) {
  const safeCommand = yield* buildDebugCommandEffect(command.command, command.args);
  const startedAt = yield* Clock.currentTimeMillis;
  const port = resolveDebugPort(context, safeCommand.port);
  const body = yield* readDebugSocketEffect(context, port, {
    durationMs,
    idleTimeoutMs,
    request: safeCommand.request,
  });
  const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;

  return {
    args: safeCommand.args,
    body,
    bytes: Buffer.byteLength(body),
    command: safeCommand.command,
    elapsedMs,
    port,
  };
});

export const captureDebugConsoleEffect: (
  context: RokuContext,
  durationMs: number,
) => Effect.Effect<DebugConsoleCapture, DebugPortUnavailable> = Effect.fn("captureDebugConsole")(
  function* (context: RokuContext, durationMs: number) {
    const startedAt = yield* Clock.currentTimeMillis;
    const port = resolveDebugPort(context, brightScriptConsolePort);
    const body = yield* readDebugSocketEffect(context, port, { durationMs });
    const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;

    return {
      body,
      bytes: Buffer.byteLength(body),
      durationMs,
      elapsedMs,
      port,
    };
  },
);

export const runDebugCommand = async (
  context: RokuContext,
  command: RokuDebugCommand,
  durationMs: number,
  idleTimeoutMs: number,
): Promise<DebugCommandResult> =>
  await Effect.runPromise(runDebugCommandEffect(context, command, durationMs, idleTimeoutMs));

export const captureDebugConsole = async (
  context: RokuContext,
  durationMs: number,
): Promise<DebugConsoleCapture> =>
  await Effect.runPromise(captureDebugConsoleEffect(context, durationMs));

const debugServerCommand = (command: string, args: readonly string[]): RokuDebugCommand => ({
  args,
  command,
  port: debugServerPort,
  request: formatDebugRequest(command, args),
});

const brightScriptConsoleCommand = (
  command: string,
  args: readonly string[],
): RokuDebugCommand => ({
  args,
  command,
  port: brightScriptConsolePort,
  request: formatDebugRequest(command, args),
});

const readDebugSocketEffect = Effect.fn("readDebugSocket")(function* (
  context: RokuContext,
  port: number,
  options: DebugSocketReadOptions,
) {
  return yield* Effect.callback<string, DebugPortUnavailable>((resume) => {
    let body = "";
    let durationTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const socket = createConnection({ host: context.target, port });

    const clearTimers = (): void => {
      if (durationTimer !== undefined) {
        clearTimeout(durationTimer);
      }

      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
    };

    const complete = (effect: Effect.Effect<string, DebugPortUnavailable>): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      socket.removeAllListeners();
      socket.destroy();
      resume(effect);
    };

    const finish = (): void => {
      complete(Effect.succeed(body));
    };

    const failRead = (detail: string): void => {
      complete(Effect.fail(new DebugPortUnavailable({ detail, port })));
    };

    const scheduleIdleTimer = (): void => {
      if (options.idleTimeoutMs === undefined) {
        return;
      }

      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }

      idleTimer = setTimeout(finish, options.idleTimeoutMs);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(context.timeoutMs);

    socket.once("connect", () => {
      socket.setTimeout(0);
      durationTimer = setTimeout(finish, options.durationMs);

      if (options.request !== undefined) {
        try {
          socket.write(options.request);
        } catch (error) {
          failRead(formatErrorMessage(error));
        }
      }
    });

    socket.on("data", (chunk: string) => {
      body = `${body}${chunk}`;
      scheduleIdleTimer();
    });

    socket.once("timeout", () => {
      failRead("connection timed out");
    });
    socket.once("error", (error) => {
      if (body.length > 0) {
        finish();
        return;
      }

      failRead(error.message);
    });
    socket.once("close", finish);

    return Effect.sync(() => {
      if (!settled) {
        settled = true;
        clearTimers();
        socket.removeAllListeners();
        socket.destroy();
      }
    });
  });
});

const formatDebugRequest = (command: string, args: readonly string[]): string =>
  `${[command, ...args].join(" ")}\r\n`;

const resolveDebugPort = (context: RokuContext, port: RokuDebugPort): number =>
  port === debugServerPort
    ? (context.debugServerPort ?? debugServerPort)
    : (context.debugConsolePort ?? brightScriptConsolePort);

const validateDebugToken = (value: string, label: string): void => {
  rejectUnsafeInput(value, label);

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(`${label} contains unsupported characters`);
  }
};

const validateChanperfArgs = (args: readonly string[]): void => {
  if (args.length === 0) {
    return;
  }

  if (args[0] === "-r") {
    fail("chanperf -r writes to the BrightScript console; use rokit console for capture");
  }

  fail("usage: rokit debug-command chanperf");
};

const normalizeSceneGraphNodeArgs = (args: readonly string[]): readonly string[] => {
  if (args.length === 1 && (args[0] === "roots" || args[0] === "all")) {
    return args;
  }

  if (args.length === 1) {
    validateDebugToken(args[0] ?? "", "sgnodes id");
    return args;
  }

  if (args.length === 2 && args[0] === "id") {
    validateDebugToken(args[1] ?? "", "sgnodes id");
    return [args[1] ?? ""];
  }

  return fail("usage: rokit debug-command sgnodes <roots|all|node-id|id node-id>");
};

const validateNoArgs = (command: string, args: readonly string[]): void => {
  if (args.length > 0) {
    fail(`usage: rokit debug-command ${command}`);
  }
};

const validateOptionalNonNegativeInteger = (args: readonly string[], command: string): void => {
  if (args.length === 0) {
    return;
  }

  if (args.length === 1) {
    validateNonNegativeInteger(args[0] ?? "", `${command} argument`);
    return;
  }

  fail(`usage: rokit debug-command ${command} [id]`);
};

const validateNonNegativeInteger = (value: string, label: string): void => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`Invalid ${label}: ${value}`);
  }
};
