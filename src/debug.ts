import { createConnection } from "node:net";
import { DebugPortUnavailable } from "./errors.js";
import { fail, rejectUnsafeInput } from "./runtime.js";
import type { RokuContext } from "./roku.js";

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

export const runDebugCommand = async (
  context: RokuContext,
  command: RokuDebugCommand,
  durationMs: number,
  idleTimeoutMs: number,
): Promise<DebugCommandResult> => {
  const safeCommand = buildDebugCommand(command.command, command.args);
  const startedAt = Date.now();
  const port = resolveDebugPort(context, safeCommand.port);
  const body = await readDebugSocket(context, port, {
    durationMs,
    idleTimeoutMs,
    request: safeCommand.request,
  });
  const elapsedMs = Date.now() - startedAt;

  return {
    args: safeCommand.args,
    body,
    bytes: Buffer.byteLength(body),
    command: safeCommand.command,
    elapsedMs,
    port,
  };
};

export const captureDebugConsole = async (
  context: RokuContext,
  durationMs: number,
): Promise<DebugConsoleCapture> => {
  const startedAt = Date.now();
  const port = resolveDebugPort(context, brightScriptConsolePort);
  const body = await readDebugSocket(context, port, { durationMs });
  const elapsedMs = Date.now() - startedAt;

  return {
    body,
    bytes: Buffer.byteLength(body),
    durationMs,
    elapsedMs,
    port,
  };
};

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

const readDebugSocket = async (
  context: RokuContext,
  port: number,
  options: DebugSocketReadOptions,
): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    let body = "";
    let durationTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
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

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      socket.destroy();
      resolve(body);
    };

    const failRead = (detail: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      socket.destroy();
      reject(DebugPortUnavailable.make({ detail, port }));
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
        socket.write(options.request);
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
