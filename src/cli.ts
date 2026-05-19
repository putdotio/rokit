import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createRequire } from "node:module";
import { Effect } from "effect";
import {
  buildDebugCommand,
  captureDebugConsole,
  runDebugCommand,
  type RokuDebugCommand,
} from "./debug.js";
import {
  assertSceneGraphNode,
  captureScreenshot,
  checkDevice,
  discoverRokuDevices,
  getDeviceInfo,
  installPackage,
  launchApp,
  packageChannel,
  pressKey,
  queryActiveApp,
  queryEcp,
  queryMediaPlayer,
  querySceneGraph,
  resolvePackageOutputPath,
  validateRemoteKey,
  waitForActiveApp,
  waitForMediaPlayerState,
  waitForSceneGraphNode,
  type RokuContext,
} from "./roku.js";
import { readSceneGraphFailure, readSceneGraphStatus, type NodeExpectation } from "./scenegraph.js";
import { normalizeError, renderError } from "./errors.js";
import {
  fail,
  loadEnv,
  loadLocalEnv,
  rejectUnsafeEcpPath,
  requirePassword,
  requireTarget,
  resolveFileOutputPath,
  resolveOutputPath,
} from "./runtime.js";

type LaunchArgs = {
  readonly appId: string;
  readonly params: ReadonlyMap<string, string>;
};

type NodeCondition = {
  readonly expectation: NodeExpectation;
  readonly nodeName: string;
  readonly timeoutMs?: number;
};

type PressArgs = {
  readonly delayMs: number;
  readonly keys: readonly string[];
  readonly maxAttempts: number;
  readonly until?: NodeCondition;
};

type ConsoleArgs = {
  readonly durationMs: number;
  readonly outputPath: string;
};

type DebugCommandArgs = {
  readonly command: RokuDebugCommand;
  readonly durationMs: number;
  readonly idleTimeoutMs: number;
};

type OutputMode = "json" | "text";

type CliOptions = {
  readonly args: readonly string[];
  readonly dryRun: boolean;
  readonly fields: readonly string[];
  readonly inputJson?: string;
  readonly outputMode: OutputMode;
};

type CommandResult = {
  readonly command: string;
  readonly data?: unknown;
  readonly dryRun?: true;
  readonly failedObservations?: readonly string[];
  readonly message?: string;
  readonly partial?: true;
  readonly status: "ok";
};

type DescribedField = {
  readonly description: string;
  readonly name: string;
  readonly required: boolean;
  readonly repeatable?: boolean;
  readonly type: string;
  readonly values?: readonly string[];
};

type DescribedCommand = {
  readonly description: string;
  readonly inputJson: {
    readonly fields: readonly DescribedField[];
    readonly required: readonly string[];
  };
  readonly mutates: boolean;
  readonly name: string;
  readonly parameters: readonly DescribedField[];
  readonly requiresTarget: boolean;
};

type Command =
  | { readonly name: "active-app" }
  | { readonly args: NodeCondition; readonly name: "assert-node" }
  | { readonly name: "check" }
  | { readonly args: ConsoleArgs; readonly name: "console" }
  | { readonly args: DebugCommandArgs; readonly name: "debug-command" }
  | { readonly name: "describe" }
  | { readonly name: "device-info" }
  | { readonly name: "discover"; readonly timeoutMs?: number }
  | { readonly name: "install"; readonly zipPath: string }
  | { readonly name: "launch"; readonly args: LaunchArgs }
  | { readonly name: "media-player" }
  | { readonly name: "package"; readonly outputPath: string }
  | { readonly name: "proof"; readonly outputDir: string; readonly screenshot: boolean }
  | { readonly args: PressArgs; readonly name: "press" }
  | { readonly name: "query"; readonly path: string }
  | { readonly name: "screenshot"; readonly outputPath: string }
  | { readonly name: "sgnodes" }
  | { readonly name: "snapshot" }
  | { readonly appId: string; readonly name: "wait-active"; readonly timeoutMs?: number }
  | { readonly name: "wait-media-player"; readonly state: string; readonly timeoutMs?: number }
  | { readonly args: NodeCondition; readonly name: "wait-node" }
  | {
      readonly appId: string;
      readonly mediaState?: string;
      readonly name: "wait-ready";
      readonly node?: NodeCondition;
      readonly timeoutMs?: number;
    };

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const defaultConsoleDurationMs = 30_000;
const defaultDebugCommandDurationMs = 3_000;
const defaultDebugCommandIdleTimeoutMs = 500;

export const mainEffect = Effect.fn("mainEffect")(function* (argv = process.argv.slice(2)) {
  let outputMode = inferOutputMode(argv);
  let fields: readonly string[] = [];

  yield* Effect.tryPromise({
    try: async () => {
      await runMain(
        argv,
        (mode) => {
          outputMode = mode;
        },
        (nextFields) => {
          fields = nextFields;
        },
      );
    },
    catch: normalizeError,
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        printError(outputMode, renderError(error), fields);
        process.exitCode = 1;
      }),
    ),
  );
});

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  await Effect.runPromise(mainEffect(argv));
};

const runMain = async (
  argv: readonly string[],
  setOutputMode: (outputMode: OutputMode) => void,
  setFields: (fields: readonly string[]) => void,
): Promise<void> => {
  const options = parseGlobalOptions(argv);
  const fields = options.fields;
  setOutputMode(options.outputMode);
  setFields(fields);
  const firstArg = options.inputJson === undefined ? options.args[0] : "input-json";

  if (
    options.inputJson === undefined &&
    (!firstArg || firstArg === "--help" || firstArg === "-h")
  ) {
    printHelp();
    return;
  }

  if (options.inputJson === undefined && (firstArg === "--version" || firstArg === "-v")) {
    console.log(packageJson.version);
    return;
  }

  const command = parseCommand(options);
  let context: RokuContext | undefined;

  if (commandNeedsTarget(command, options.dryRun)) {
    loadLocalEnv();
    const env = loadEnv();
    context = {
      password: env.password,
      target: requireTarget(env),
      timeoutMs: env.timeoutMs,
      username: env.username,
    };
  }

  const result = await runCommand(context, command, options.dryRun);

  printResult(options.outputMode, result, fields);
};

const runCommand = async (
  context: RokuContext | undefined,
  command: Command,
  dryRun: boolean,
): Promise<CommandResult> => {
  if (command.name === "describe") {
    return { command: command.name, data: describeCli(), status: "ok" };
  }

  if (command.name === "discover") {
    if (dryRun) {
      return dryRunResult(command.name, { timeoutMs: command.timeoutMs ?? 3_000 });
    }

    const devices = await discoverRokuDevices(command.timeoutMs);
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
    const outputPath = resolveFileOutputPath(command.outputPath, "package output path");

    if (dryRun) {
      return dryRunResult(command.name, { path: resolvePackageOutputPath(outputPath) });
    }

    const result = await packageChannel(outputPath);
    return {
      command: command.name,
      data: result,
      message: `package: ${result.path}`,
      status: "ok",
    };
  }

  if (dryRun && commandSupportsDryRun(command)) {
    return dryRunResult(command.name, dryRunData(command));
  }

  const deviceContext = requireContext(context);

  if (command.name === "check") {
    const summary = await checkDevice(deviceContext);
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
    const requestedPath = resolveFileOutputPath(command.args.outputPath, "console output path");
    const path = timestampOutputPath(requestedPath);
    const capture = await captureDebugConsole(deviceContext, command.args.durationMs);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, capture.body);

    return {
      command: command.name,
      data: { ...capture, path },
      message: `console: ${path}`,
      status: "ok",
    };
  }

  if (command.name === "debug-command") {
    const result = await runDebugCommand(
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
    return { command: command.name, data: await getDeviceInfo(deviceContext), status: "ok" };
  }

  if (command.name === "active-app") {
    const app = await queryActiveApp(deviceContext);
    return {
      command: command.name,
      data: app,
      message: `active app: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "media-player") {
    const mediaPlayer = await queryMediaPlayer(deviceContext);
    return {
      command: command.name,
      data: mediaPlayer,
      message: formatMediaPlayerMessage(mediaPlayer),
      status: "ok",
    };
  }

  if (command.name === "wait-media-player") {
    const mediaPlayer = await waitForMediaPlayerState(
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
    const app = await waitForActiveApp(deviceContext, command.appId, command.timeoutMs);
    return {
      command: command.name,
      data: app,
      message: `active app: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "launch") {
    if (dryRun) {
      return dryRunResult(command.name, {
        appId: command.args.appId,
        params: Object.fromEntries(command.args.params),
      });
    }

    const app = await launchApp(deviceContext, command.args.appId, command.args.params);
    return {
      command: command.name,
      data: app,
      message: `launched: ${app.id} ${app.name} ${app.version}`.trim(),
      status: "ok",
    };
  }

  if (command.name === "press") {
    if (dryRun) {
      return dryRunResult(command.name, {
        delayMs: command.args.delayMs,
        keys: command.args.keys,
        maxAttempts: command.args.maxAttempts,
        until: command.args.until ? formatNodeData(command.args.until) : undefined,
      });
    }

    const pressed: string[] = [];
    let attempts = 0;

    while (attempts < command.args.maxAttempts) {
      attempts += 1;

      for (const [index, key] of command.args.keys.entries()) {
        if ((index > 0 || attempts > 1) && command.args.delayMs > 0) {
          await sleep(command.args.delayMs);
        }

        await pressKey(deviceContext, key);
        pressed.push(key);
      }

      if (!command.args.until) {
        break;
      }

      try {
        await assertSceneGraphNode(
          deviceContext,
          command.args.until.nodeName,
          command.args.until.expectation,
        );
        break;
      } catch (error) {
        if (attempts >= command.args.maxAttempts) {
          throw error;
        }
      }
    }

    return {
      command: command.name,
      data: {
        attempts,
        delayMs: command.args.delayMs,
        keys: pressed,
        until: command.args.until ? formatNodeData(command.args.until) : undefined,
      },
      message: pressed.map((key) => `pressed: ${key}`).join("\n"),
      status: "ok",
    };
  }

  if (command.name === "query") {
    const body = await queryEcp(deviceContext, command.path);
    return {
      command: command.name,
      data: { body, path: command.path },
      message: body,
      status: "ok",
    };
  }

  if (command.name === "sgnodes") {
    const body = await querySceneGraph(deviceContext);
    return { command: command.name, data: { body }, message: body, status: "ok" };
  }

  if (command.name === "assert-node") {
    await assertSceneGraphNode(deviceContext, command.args.nodeName, command.args.expectation);
    return {
      command: command.name,
      data: formatNodeData(command.args),
      message: `asserted node: ${formatNodeCondition(command.args)}`,
      status: "ok",
    };
  }

  if (command.name === "wait-node") {
    await waitForSceneGraphNode(
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
    const requestedPath = resolveFileOutputPath(command.outputPath, "screenshot output path");
    const path = timestampOutputPath(requestedPath);

    if (dryRun) {
      return dryRunResult(command.name, { path });
    }

    const password = requirePassword(deviceContext);
    const screenshotPath = await captureScreenshot({ ...deviceContext, password }, path);
    return {
      command: command.name,
      data: { path: screenshotPath },
      message: `screenshot: ${screenshotPath}`,
      status: "ok",
    };
  }

  if (command.name === "snapshot") {
    const data = await collectSnapshot(deviceContext);
    return observationResult(command.name, data);
  }

  if (command.name === "proof") {
    const outputDir = resolveOutputPath(command.outputDir, "proof output directory");

    if (dryRun) {
      return dryRunResult(command.name, { outputDir, screenshot: command.screenshot });
    }

    const data = await writeProof(deviceContext, outputDir, command.screenshot);
    return {
      command: command.name,
      data,
      ...partialObservationMetadata(data.snapshot),
      message: data.artifacts.map((artifact) => `${artifact.kind}: ${artifact.path}`).join("\n"),
      status: "ok",
    };
  }

  if (command.name === "wait-ready") {
    const data = await waitForReady(deviceContext, command);
    const failedObservations = data.sceneGraph.status === "failed" ? ["sceneGraph"] : [];
    return {
      command: command.name,
      data,
      ...(failedObservations.length > 0
        ? { failedObservations, partial: true as const }
        : undefined),
      message: `ready: active app ${data.activeApp.id}`,
      status: "ok",
    };
  }

  if (command.name === "install") {
    if (dryRun) {
      return dryRunResult(command.name, { zipPath: command.zipPath });
    }

    const password = requirePassword(deviceContext);
    const message = await installPackage({ ...deviceContext, password }, command.zipPath);
    return { command: command.name, data: { message }, message, status: "ok" };
  }

  throw new Error("unsupported command");
};

const requireContext = (context: RokuContext | undefined): RokuContext => {
  if (!context) {
    return fail("ROKIT_TARGET is not set");
  }

  return context;
};

const dryRunResult = (command: string, data: unknown): CommandResult => ({
  command,
  data,
  dryRun: true,
  message: `dry-run: ${command}`,
  status: "ok",
});

type Observation<T> =
  | { readonly data: T; readonly status: "ok" }
  | { readonly error: { readonly message: string }; readonly status: "failed" };

type ProofArtifact = {
  readonly kind: "json" | "screenshot" | "xml";
  readonly path: string;
};

const observe = async <T>(read: () => Promise<T>): Promise<Observation<T>> => {
  try {
    return { data: await read(), status: "ok" };
  } catch (error) {
    return { error: { message: renderError(normalizeError(error)) }, status: "failed" };
  }
};

const collectSnapshot = async (context: RokuContext) => {
  const sceneGraph = await observe(async () => await querySceneGraph(context));
  const sceneGraphBody = sceneGraph.status === "ok" ? sceneGraph.data : undefined;

  return {
    activeApp: await observe(async () => await queryActiveApp(context)),
    device: await observe(async () => await checkDevice(context)),
    mediaPlayer: await observe(async () => await queryMediaPlayer(context)),
    sceneGraph:
      sceneGraphBody === undefined
        ? sceneGraph
        : {
            data: {
              failure: readSceneGraphFailure(sceneGraphBody),
              status: readSceneGraphStatus(sceneGraphBody),
            },
            status: "ok",
          },
  };
};

const observationResult = (command: string, data: Awaited<ReturnType<typeof collectSnapshot>>) => ({
  command,
  data,
  ...partialObservationMetadata(data),
  status: "ok" as const,
});

const partialObservationMetadata = (snapshot: Awaited<ReturnType<typeof collectSnapshot>>) => {
  const failedObservations = failedSnapshotObservations(snapshot);

  return failedObservations.length === 0
    ? {}
    : {
        failedObservations,
        partial: true as const,
      };
};

const failedSnapshotObservations = (
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
): readonly string[] => {
  const failures: string[] = [];

  if (snapshot.activeApp.status === "failed") {
    failures.push("activeApp");
  }

  if (snapshot.device.status === "failed") {
    failures.push("device");
  }

  if (snapshot.mediaPlayer.status === "failed") {
    failures.push("mediaPlayer");
  }

  if (snapshot.sceneGraph.status === "failed") {
    failures.push("sceneGraph");
  }

  return failures;
};

const writeProof = async (context: RokuContext, outputDir: string, includeScreenshot: boolean) => {
  mkdirSync(outputDir, { recursive: true });

  const artifacts: ProofArtifact[] = [];
  const writeJson = (name: string, value: unknown) => {
    const path = `${outputDir}/${name}.json`;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    artifacts.push({ kind: "json", path });
    return path;
  };

  const snapshot = await collectSnapshot(context);
  writeJson("summary", snapshot);

  const sceneGraph = await observe(async () => await querySceneGraph(context));
  if (sceneGraph.status === "ok") {
    const path = `${outputDir}/sgnodes.xml`;
    writeFileSync(path, sceneGraph.data);
    artifacts.push({ kind: "xml", path });
  }

  writeJson("device-info", await observe(async () => await getDeviceInfo(context)));
  writeJson("active-app", await observe(async () => await queryActiveApp(context)));
  writeJson("media-player", await observe(async () => await queryMediaPlayer(context)));

  if (includeScreenshot) {
    const password = requirePassword(context);
    const path = await captureScreenshot(
      { ...context, password },
      timestampOutputPath(`${outputDir}/screenshot.png`),
    );
    artifacts.push({ kind: "screenshot", path });
  }

  return { artifacts, outputDir, snapshot };
};

const timestampOutputPath = (path: string, date = new Date()): string => {
  const extension = extname(path);
  const name = basename(path, extension);
  return join(dirname(path), `${name}-${formatTimestamp(date)}${extension}`);
};

const formatTimestamp = (date: Date): string =>
  [
    date.getFullYear().toString(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    "-",
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
    "-",
    padDatePart(date.getMilliseconds(), 3),
  ].join("");

const padDatePart = (value: number, length = 2): string => value.toString().padStart(length, "0");

const waitForReady = async (
  context: RokuContext,
  command: Extract<Command, { name: "wait-ready" }>,
) => {
  const activeApp = await waitForActiveApp(context, command.appId, command.timeoutMs);
  const sceneGraph = await observe(async () =>
    querySceneGraph(context, { attempts: 3, requireComplete: true }),
  );

  if (command.node) {
    await waitForSceneGraphNode(
      context,
      command.node.nodeName,
      command.node.expectation,
      command.node.timeoutMs ?? command.timeoutMs,
    );
  }

  const mediaPlayer = command.mediaState
    ? {
        data: await waitForMediaPlayerState(context, command.mediaState, command.timeoutMs),
        status: "ok",
      }
    : await observe(async () => queryMediaPlayer(context));

  return {
    activeApp,
    mediaPlayer,
    sceneGraph:
      sceneGraph.status === "ok"
        ? {
            data: {
              failure: readSceneGraphFailure(sceneGraph.data),
              status: readSceneGraphStatus(sceneGraph.data),
            },
            status: "ok",
          }
        : sceneGraph,
  };
};

const commandNeedsTarget = (command: Command, dryRun: boolean): boolean => {
  if (command.name === "describe" || command.name === "discover" || command.name === "package") {
    return false;
  }

  return !(dryRun && commandSupportsDryRun(command));
};

const commandSupportsDryRun = (command: Command): boolean =>
  command.name === "console" ||
  command.name === "debug-command" ||
  command.name === "install" ||
  command.name === "launch" ||
  command.name === "package" ||
  command.name === "press" ||
  command.name === "proof" ||
  command.name === "screenshot";

const dryRunData = (command: Command): unknown => {
  if (command.name === "launch") {
    return { appId: command.args.appId, params: Object.fromEntries(command.args.params) };
  }

  if (command.name === "press") {
    for (const key of command.args.keys) {
      validateRemoteKey(key);
    }

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
        resolveFileOutputPath(command.args.outputPath, "console output path"),
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
        resolveFileOutputPath(command.outputPath, "screenshot output path"),
      ),
    };
  }

  if (command.name === "proof") {
    return {
      outputDir: resolveOutputPath(command.outputDir, "proof output directory"),
      screenshot: command.screenshot,
    };
  }

  if (command.name === "package") {
    return { path: resolveOutputPath(command.outputPath, "package output path") };
  }

  if (command.name === "install") {
    return { zipPath: command.zipPath };
  }

  return {};
};

const parseGlobalOptions = (argv: readonly string[]): CliOptions => {
  const args: string[] = [];
  let dryRun = false;
  let fields: readonly string[] = [];
  let inputJson: string | undefined;
  let outputMode = defaultOutputMode();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--fields") {
      const value = argv[index + 1];

      if (!value) {
        fail("usage: rokit [--fields field[,field...]] <command>");
      }

      fields = value
        .split(",")
        .map((field) => field.trim())
        .filter((field) => field.length > 0);
      outputMode = "json";
      index += 1;
      continue;
    }

    if (arg === "--input-json") {
      const value = argv[index + 1];

      if (!value) {
        fail("usage: rokit --input-json '<payload>'");
      }

      if (inputJson !== undefined) {
        fail("usage: rokit --input-json '<payload>'");
      }

      inputJson = value;
      outputMode = "json";
      index += 1;
      continue;
    }

    if (arg === "--json") {
      outputMode = "json";
      continue;
    }

    if (arg === "--output") {
      const value = argv[index + 1];

      if (value !== "json" && value !== "text") {
        fail("usage: rokit [--json|--output json|--output text] <command>");
      }

      outputMode = value === "json" ? "json" : "text";
      index += 1;
      continue;
    }

    args.push(arg);
  }

  if (inputJson !== undefined && args.length > 0) {
    fail("usage: rokit --input-json '<payload>'");
  }

  return { args, dryRun, fields, inputJson, outputMode };
};

const inferOutputMode = (argv: readonly string[]): OutputMode => {
  if (argv.includes("--json")) {
    return "json";
  }

  const outputIndex = argv.indexOf("--output");
  if (argv[outputIndex + 1] === "json") {
    return "json";
  }

  if (argv[outputIndex + 1] === "text") {
    return "text";
  }

  if (argv.includes("--input-json") || argv.includes("--fields")) {
    return "json";
  }

  return defaultOutputMode();
};

const defaultOutputMode = (): OutputMode => (process.stdout.isTTY ? "text" : "json");

const printResult = (
  outputMode: OutputMode,
  result: CommandResult,
  fields: readonly string[],
): void => {
  if (outputMode === "json") {
    console.log(JSON.stringify(applyFields(result, fields), null, 2));
    return;
  }

  if (result.message !== undefined) {
    console.log(result.message);
    return;
  }

  console.log(JSON.stringify(result.data, null, 2));
};

const printError = (outputMode: OutputMode, message: string, _fields: readonly string[]): void => {
  if (outputMode === "json") {
    console.error(JSON.stringify({ error: { message }, status: "failed" }, null, 2));
    return;
  }

  console.error(message);
};

const parseCommand = (options: CliOptions): Command => {
  if (options.inputJson !== undefined) {
    return parseInputJson(options.inputJson);
  }

  const argv = options.args;
  const [name, ...args] = argv;

  if (name === "describe") {
    return { name };
  }

  if (name === "check") {
    return { name };
  }

  if (name === "console") {
    return { name, args: parseConsoleArgs(args) };
  }

  if (name === "debug-command") {
    return { name, args: parseDebugCommandArgs(args) };
  }

  if (name === "discover") {
    return { name, timeoutMs: parseOptionalTimeout(args, "rokit discover") };
  }

  if (name === "device-info") {
    return { name };
  }

  if (name === "active-app") {
    return { name };
  }

  if (name === "media-player") {
    return { name };
  }

  if (name === "wait-media-player") {
    const state = args[0];

    if (!state) {
      fail("usage: rokit wait-media-player <state> [--timeout-ms <ms>]");
    }

    return {
      name,
      state,
      timeoutMs: parseTimeoutOption(args.slice(1), "rokit wait-media-player <state>"),
    };
  }

  if (name === "wait-ready") {
    return parseWaitReadyArgs(args);
  }

  if (name === "wait-active") {
    const appId = args[0];

    if (!appId) {
      fail("usage: rokit wait-active <app-id> [--timeout-ms <ms>]");
    }

    return {
      appId,
      name,
      timeoutMs: parseTimeoutOption(args.slice(1), `rokit ${name} <app-id>`),
    };
  }

  if (name === "launch") {
    return { name, args: parseLaunchArgs(args) };
  }

  if (name === "press") {
    return { name, args: parsePressArgs(args) };
  }

  if (name === "query") {
    const path = args[0];

    if (!path) {
      fail("usage: rokit query <ecp-path>");
    }

    rejectUnsafeEcpPath(path);
    return { name, path };
  }

  if (name === "sgnodes") {
    return { name };
  }

  if (name === "assert-node" || name === "wait-node") {
    return { name, args: parseNodeCondition(name, args) };
  }

  if (name === "screenshot") {
    const outputPath = args[0];

    if (!outputPath) {
      fail("usage: rokit screenshot <output-path>");
    }

    return { name, outputPath };
  }

  if (name === "snapshot") {
    return { name };
  }

  if (name === "proof") {
    return parseProofArgs(args);
  }

  if (name === "package") {
    return { name, outputPath: parseOutputPath(args, "rokit package --out <zip-path>") };
  }

  if (name === "install") {
    const zipPath = args[0];

    if (!zipPath) {
      fail("usage: rokit install <zip-path>");
    }

    return { name, zipPath };
  }

  return fail(`Unknown command: ${name ?? ""}`);
};

const parseNodeCondition = (commandName: string, args: readonly string[]): NodeCondition => {
  const [nodeName, condition, ...rest] = args;

  if (!nodeName || !condition) {
    return fail(
      `usage: rokit ${commandName} <node-name> <visible|hidden|absent|text|attr> [value] [--timeout-ms <ms>]`,
    );
  }

  if (condition === "visible" || condition === "hidden" || condition === "absent") {
    const timeoutMs = parseTimeoutOption(rest, `rokit ${commandName} <node-name> ${condition}`);
    return {
      expectation: { state: condition },
      nodeName,
      timeoutMs,
    };
  }

  if (condition === "text") {
    const [text, ...optionArgs] = rest;

    if (text === undefined) {
      fail(`usage: rokit ${commandName} <node-name> text <expected-text>`);
    }

    return {
      expectation: { state: "visible", text },
      nodeName,
      timeoutMs: parseTimeoutOption(optionArgs, `rokit ${commandName} <node-name> text`),
    };
  }

  if (condition === "attr") {
    const [pair, ...optionArgs] = rest;

    if (pair === undefined) {
      fail(`usage: rokit ${commandName} <node-name> attr <name=value>`);
    }

    const equalsIndex = pair.indexOf("=");

    if (equalsIndex <= 0) {
      fail(`Invalid attr condition: ${pair}`);
    }

    return {
      expectation: {
        attribute: pair.slice(0, equalsIndex),
        value: pair.slice(equalsIndex + 1),
      },
      nodeName,
      timeoutMs: parseTimeoutOption(optionArgs, `rokit ${commandName} <node-name> attr`),
    };
  }

  return fail(`Unknown node condition: ${condition}`);
};

const parsePressArgs = (args: readonly string[]): PressArgs => {
  let delayMs = 0;
  let maxAttempts = 1;
  let maxAttemptsWasProvided = false;
  const keys: string[] = [];
  let until: NodeCondition | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--delay-ms") {
      const value = args[index + 1];

      if (!value) {
        fail("usage: rokit press [--delay-ms <ms>] <key> [key...]");
      }

      delayMs = parsePositiveInteger(value, "delay");
      index += 1;
      continue;
    }

    if (arg === "--max") {
      const value = args[index + 1];

      if (!value) {
        fail(
          "usage: rokit press [--delay-ms <ms>] [--until-node ... --max <count>] <key> [key...]",
        );
      }

      maxAttempts = parsePositiveInteger(value, "max attempts");
      maxAttemptsWasProvided = true;
      index += 1;
      continue;
    }

    if (arg === "--until-node") {
      const nodeArgs = args.slice(index + 1);
      until = parseNodeCondition("press --until-node", nodeArgs);
      if (!maxAttemptsWasProvided) {
        maxAttempts = 8;
      }
      break;
    }

    if (arg?.startsWith("--")) {
      fail(`Unknown press option: ${arg}`);
    }

    if (arg !== undefined) {
      keys.push(arg);
    }
  }

  if (keys.length === 0) {
    fail("usage: rokit press [--delay-ms <ms>] <key> [key...]");
  }

  return { delayMs, keys, maxAttempts, until };
};

const parseOptionalTimeout = (args: readonly string[], usagePrefix: string): number | undefined =>
  args.length === 0 ? undefined : parseTimeoutOption(args, usagePrefix);

const parseOutputPath = (args: readonly string[], usage: string): string => {
  if (args.length === 1 && args[0] !== undefined && !args[0].startsWith("--")) {
    return args[0];
  }

  if (args.length === 2 && args[0] === "--out" && args[1] !== undefined) {
    return args[1];
  }

  return fail(`usage: ${usage}`);
};

const parseConsoleArgs = (args: readonly string[]): ConsoleArgs => {
  let outputPath: string | undefined;
  let durationMs = defaultConsoleDurationMs;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--duration-ms") {
      durationMs = parsePositiveInteger(args[index + 1] ?? "", "duration");
      index += 1;
      continue;
    }

    if (arg?.startsWith("--")) {
      fail(`Unknown console option: ${arg}`);
    }

    if (outputPath !== undefined || arg === undefined) {
      fail("usage: rokit console <output-path> [--duration-ms <ms>]");
    }

    outputPath = arg;
  }

  if (outputPath !== undefined) {
    return { durationMs, outputPath };
  }

  return fail("usage: rokit console <output-path> [--duration-ms <ms>]");
};

const parseDebugCommandArgs = (args: readonly string[]): DebugCommandArgs => {
  let durationMs = defaultDebugCommandDurationMs;
  let idleTimeoutMs = defaultDebugCommandIdleTimeoutMs;
  const commandArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--duration-ms") {
      durationMs = parsePositiveInteger(args[index + 1] ?? "", "duration");
      index += 1;
      continue;
    }

    if (arg === "--idle-timeout-ms") {
      idleTimeoutMs = parsePositiveInteger(args[index + 1] ?? "", "idle timeout");
      index += 1;
      continue;
    }

    if (arg !== undefined) {
      commandArgs.push(arg);
    }
  }

  const [command, ...debugArgs] = commandArgs;

  if (command === undefined) {
    fail("usage: rokit debug-command <command> [args...] [--duration-ms <ms>]");
  }

  return {
    command: buildDebugCommand(command, debugArgs),
    durationMs,
    idleTimeoutMs,
  };
};

const parseProofArgs = (args: readonly string[]): Extract<Command, { name: "proof" }> => {
  let outputDir: string | undefined;
  let screenshot = false;
  const assignOutputDir = (nextOutputDir: string | undefined): void => {
    if (!nextOutputDir) {
      fail("usage: rokit proof <output-dir> [--screenshot]");
    }

    if (outputDir !== undefined) {
      fail("usage: rokit proof <output-dir> [--screenshot]");
    }

    outputDir = nextOutputDir;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out") {
      assignOutputDir(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--screenshot") {
      screenshot = true;
      continue;
    }

    if (arg?.startsWith("--")) {
      fail(`Unknown proof option: ${arg}`);
    }

    assignOutputDir(arg);
  }

  if (!outputDir) {
    return fail("usage: rokit proof <output-dir> [--screenshot]");
  }

  return { name: "proof", outputDir, screenshot };
};

const parseWaitReadyArgs = (args: readonly string[]): Extract<Command, { name: "wait-ready" }> => {
  const appId = args[0];

  if (!appId) {
    return fail(
      "usage: rokit wait-ready <app-id> [--media-state <state>] [--node ...] [--timeout-ms <ms>]",
    );
  }

  let mediaState: string | undefined;
  let node: NodeCondition | undefined;
  let timeoutMs: number | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--media-state") {
      mediaState = args[index + 1];

      if (!mediaState) {
        fail("usage: rokit wait-ready <app-id> --media-state <state>");
      }

      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(args[index + 1] ?? "", "timeout");
      index += 1;
      continue;
    }

    if (arg === "--node") {
      node = parseNodeCondition("wait-ready --node", args.slice(index + 1));
      break;
    }

    fail(`Unknown wait-ready option: ${arg ?? ""}`);
  }

  return { appId, mediaState, name: "wait-ready", node, timeoutMs: timeoutMs ?? node?.timeoutMs };
};

const parseInputJson = (value: string): Command => {
  const parsed = requireRecord(JSON.parse(value), "input JSON");

  const command = readString(parsed, "command");

  if (command === "describe") {
    return { name: "describe" };
  }

  if (command === "discover") {
    return { name: "discover", timeoutMs: readOptionalNumber(parsed, "timeoutMs") };
  }

  if (command === "check" || command === "device-info" || command === "active-app") {
    return { name: command };
  }

  if (command === "console") {
    return {
      args: {
        durationMs: readOptionalNumber(parsed, "durationMs") ?? defaultConsoleDurationMs,
        outputPath: readString(parsed, "outputPath"),
      },
      name: "console",
    };
  }

  if (command === "debug-command") {
    return {
      args: {
        command: buildDebugCommand(
          readString(parsed, "debugCommand"),
          readOptionalStringArray(parsed, "args") ?? [],
        ),
        durationMs: readOptionalNumber(parsed, "durationMs") ?? defaultDebugCommandDurationMs,
        idleTimeoutMs:
          readOptionalNumber(parsed, "idleTimeoutMs") ?? defaultDebugCommandIdleTimeoutMs,
      },
      name: "debug-command",
    };
  }

  if (command === "media-player" || command === "sgnodes" || command === "snapshot") {
    return { name: command };
  }

  if (command === "wait-active") {
    return {
      appId: readString(parsed, "appId"),
      name: "wait-active",
      timeoutMs: readOptionalNumber(parsed, "timeoutMs"),
    };
  }

  if (command === "wait-media-player") {
    return {
      name: "wait-media-player",
      state: readString(parsed, "state"),
      timeoutMs: readOptionalNumber(parsed, "timeoutMs"),
    };
  }

  if (command === "wait-ready") {
    return {
      appId: readString(parsed, "appId"),
      mediaState: readOptionalString(parsed, "mediaState"),
      name: "wait-ready",
      node: readOptionalNodeCondition(parsed, "node"),
      timeoutMs: readOptionalNumber(parsed, "timeoutMs"),
    };
  }

  if (command === "launch") {
    return {
      args: {
        appId: readString(parsed, "appId"),
        params: readStringMap(parsed, "params"),
      },
      name: "launch",
    };
  }

  if (command === "press") {
    const keys = readStringArray(parsed, "keys");
    const until = readOptionalNodeCondition(parsed, "until");

    if (keys.length === 0) {
      fail("input JSON field must include at least one key: keys");
    }

    return {
      args: {
        delayMs: readOptionalNumber(parsed, "delayMs") ?? 0,
        keys,
        maxAttempts: readOptionalNumber(parsed, "maxAttempts") ?? (until === undefined ? 1 : 8),
        until,
      },
      name: "press",
    };
  }

  if (command === "query") {
    const path = readString(parsed, "path");
    rejectUnsafeEcpPath(path);
    return { name: "query", path };
  }

  if (command === "assert-node" || command === "wait-node") {
    return {
      args: {
        expectation: readNodeExpectation(parsed),
        nodeName: readString(parsed, "nodeName"),
        timeoutMs: readOptionalNumber(parsed, "timeoutMs"),
      },
      name: command,
    };
  }

  if (command === "screenshot") {
    return { name: "screenshot", outputPath: readString(parsed, "outputPath") };
  }

  if (command === "proof") {
    return {
      name: "proof",
      outputDir: readString(parsed, "outputDir"),
      screenshot: readOptionalBoolean(parsed, "screenshot") ?? false,
    };
  }

  if (command === "package") {
    return { name: "package", outputPath: readString(parsed, "outputPath") };
  }

  if (command === "install") {
    return { name: "install", zipPath: readString(parsed, "zipPath") };
  }

  return fail(`Unknown command: ${command}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    return fail(`${label} must be an object`);
  }

  return value;
};

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    return fail(`input JSON is missing string field: ${key}`);
  }

  return value;
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return fail(`input JSON field must be a string: ${key}`);
  }

  return value;
};

const readOptionalBoolean = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    return fail(`input JSON field must be a boolean: ${key}`);
  }

  return value;
};

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fail(`input JSON field must be a positive integer: ${key}`);
  }

  return value;
};

const readStringArray = (record: Record<string, unknown>, key: string): readonly string[] => {
  const value = record[key];

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return fail(`input JSON field must be a string array: ${key}`);
  }

  return value.map((item) => String(item));
};

const readOptionalStringArray = (
  record: Record<string, unknown>,
  key: string,
): readonly string[] | undefined => {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return fail(`input JSON field must be a string array: ${key}`);
  }

  return value.map((item) => String(item));
};

const readStringMap = (
  record: Record<string, unknown>,
  key: string,
): ReadonlyMap<string, string> => {
  const value = record[key];

  if (value === undefined) {
    return new Map();
  }

  if (!isRecord(value)) {
    return fail(`input JSON field must be an object: ${key}`);
  }

  const params = new Map<string, string>();

  for (const [paramKey, paramValue] of Object.entries(value)) {
    if (typeof paramValue !== "string") {
      return fail(`input JSON map values must be strings: ${key}`);
    }

    params.set(paramKey, paramValue);
  }

  return params;
};

const readOptionalNodeCondition = (
  record: Record<string, unknown>,
  key: string,
): NodeCondition | undefined => {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return fail(`input JSON field must be an object: ${key}`);
  }

  return {
    expectation: readNodeExpectation(value),
    nodeName: readString(value, "nodeName"),
    timeoutMs: readOptionalNumber(value, "timeoutMs"),
  };
};

const readNodeExpectation = (record: Record<string, unknown>): NodeExpectation => {
  const expectation = record.expectation;

  if (isRecord(expectation)) {
    if (typeof expectation.attribute === "string" && typeof expectation.value === "string") {
      return { attribute: expectation.attribute, value: expectation.value };
    }

    const state = expectation.state;

    if (state === "visible" || state === "hidden" || state === "absent") {
      const text = expectation.text;

      if (text !== undefined && typeof text !== "string") {
        return fail("input JSON node expectation text must be a string");
      }

      return text === undefined ? { state } : { state, text };
    }
  }

  return fail("input JSON is missing a valid node expectation");
};

const parseTimeoutOption = (args: readonly string[], usagePrefix: string): number | undefined => {
  if (args.length === 0) {
    return undefined;
  }

  if (args.length !== 2 || args[0] !== "--timeout-ms") {
    fail(`usage: ${usagePrefix} [--timeout-ms <ms>]`);
  }

  return parsePositiveInteger(args[1] ?? "", "timeout");
};

const parsePositiveInteger = (value: string, label: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid ${label}: ${value}`);
  }

  return parsed;
};

const formatNodeCondition = ({ expectation, nodeName }: NodeCondition): string => {
  if ("attribute" in expectation) {
    return `${nodeName} attr ${expectation.attribute}=${expectation.value}`;
  }

  const suffix = expectation.text === undefined ? "" : ` text=${expectation.text}`;
  return `${nodeName} ${expectation.state}${suffix}`;
};

const formatNodeData = ({ expectation, nodeName, timeoutMs }: NodeCondition) => ({
  expectation,
  nodeName,
  timeoutMs,
});

const formatMediaPlayerMessage = (
  mediaPlayer: Awaited<ReturnType<typeof queryMediaPlayer>>,
): string => {
  const parts = [
    `state=${mediaPlayer.state ?? "unknown"}`,
    `container=${mediaPlayer.container ?? "unknown"}`,
    `position=${formatMaybeMs(mediaPlayer.positionMs)}`,
    `duration=${formatMaybeMs(mediaPlayer.durationMs)}`,
  ];

  return `media-player: ${parts.join(" ")}`;
};

const formatMaybeMs = (value: number | undefined): string =>
  value === undefined ? "unknown" : `${value}ms`;

const applyFields = (value: unknown, fields: readonly string[]): unknown => {
  if (fields.length === 0) {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const field of fields) {
    copyField(value, output, field.split("."));
  }

  preserveStatusMetadata(value, output);
  return output;
};

const preserveStatusMetadata = (source: unknown, target: Record<string, unknown>): void => {
  if (!isRecord(source)) {
    return;
  }

  for (const key of ["status", "partial", "failedObservations"]) {
    if (key in source) {
      target[key] = source[key];
    }
  }
};

const copyField = (
  source: unknown,
  target: Record<string, unknown>,
  path: readonly string[],
): void => {
  const [head, ...tail] = path;

  if (!head || !isRecord(source) || !(head in source)) {
    return;
  }

  if (tail.length === 0) {
    target[head] = source[head];
    return;
  }

  const child = target[head];
  const childTarget = isRecord(child) ? child : {};
  target[head] = childTarget;
  copyField(source[head], childTarget, tail);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseLaunchArgs = (args: readonly string[]): LaunchArgs => {
  const appId = args[0];

  if (!appId) {
    fail("usage: rokit launch <app-id> [--param key=value]");
  }

  const params = new Map<string, string>();

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg !== "--param") {
      fail(`Unknown launch option: ${arg ?? ""}`);
    }

    const pair = args[index + 1];

    if (!pair) {
      fail("usage: rokit launch <app-id> [--param key=value]");
    }

    const equalsIndex = pair.indexOf("=");

    if (equalsIndex <= 0) {
      fail(`Invalid launch param: ${pair}`);
    }

    params.set(pair.slice(0, equalsIndex), pair.slice(equalsIndex + 1));
    index += 1;
  }

  return { appId, params };
};

const describeCli = () => ({
  automation: {
    dryRun: true,
    inputJson: true,
    nonTtyJsonDefault: true,
    outputFields: true,
    schemaIntrospection: true,
  },
  commands: [
    commandSchema("describe", "Print machine-readable command schemas.", false, false, []),
    commandSchema("check", "Check ECP and developer installer reachability.", true, false, []),
    commandSchema("console", "Capture BrightScript console output from port 8085.", true, true, [
      argumentField("outputPath", "path", "Console log output path inside the current app root."),
      optionField("durationMs", "positive-integer", "Capture duration in milliseconds."),
    ]),
    commandSchema("debug-command", "Run an allowlisted Roku debug command.", true, true, [
      argumentField("debugCommand", "string", "Allowlisted Roku debug command."),
      argumentField("args", "string[]", "Debug command arguments.", false, true),
      optionField("durationMs", "positive-integer", "Maximum read duration in milliseconds."),
      optionField(
        "idleTimeoutMs",
        "positive-integer",
        "Stop reading after this many idle milliseconds.",
      ),
    ]),
    commandSchema("discover", "Discover Roku ECP devices with SSDP.", false, false, [
      optionField("timeoutMs", "positive-integer", "Discovery timeout in milliseconds."),
    ]),
    commandSchema("device-info", "Read enhanced Roku device metadata.", true, false, []),
    commandSchema("active-app", "Read the foreground app.", true, false, []),
    commandSchema("media-player", "Read parsed /query/media-player state.", true, false, []),
    commandSchema("snapshot", "Read a compact state snapshot.", true, false, []),
    commandSchema("proof", "Write reviewable state artifacts.", true, true, [
      argumentField("outputDir", "path", "Directory where proof artifacts are written."),
      optionField("screenshot", "boolean", "Include a developer screenshot."),
    ]),
    commandSchema("package", "Create a sideload ZIP from the current app root.", false, true, [
      optionField("outputPath", "path", "ZIP output path inside the current app root.", true),
    ]),
    commandSchema("install", "Publish an existing ZIP to a developer-enabled Roku.", true, true, [
      argumentField("zipPath", "path", "Existing sideload ZIP path."),
    ]),
    commandSchema("launch", "Launch an app by id with optional params.", true, true, [
      argumentField("appId", "string", "Roku application id."),
      optionField("params", "record<string,string>", "Launch parameters.", false, true),
    ]),
    commandSchema(
      "press",
      "Send remote keys, optionally until a node condition matches.",
      true,
      true,
      [
        argumentField("keys", "string[]", "Remote keys to send.", true, true),
        optionField("delayMs", "positive-integer", "Delay between keys in milliseconds."),
        optionField("maxAttempts", "positive-integer", "Maximum repeated attempts."),
        optionField("until", "node-condition", "SceneGraph condition that stops the loop."),
      ],
    ),
    commandSchema("query", "Read a raw ECP path.", true, false, [
      argumentField("path", "ecp-path", "Raw ECP path without query string or fragment."),
    ]),
    commandSchema("sgnodes", "Read raw SceneGraph XML.", true, false, []),
    commandSchema(
      "assert-node",
      "Assert one SceneGraph node condition.",
      true,
      false,
      [...nodeConditionFields()],
      [...nodeConditionInputJsonFields()],
    ),
    commandSchema(
      "wait-node",
      "Wait for a SceneGraph node condition.",
      true,
      false,
      [
        ...nodeConditionFields(),
        optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
      ],
      [
        ...nodeConditionInputJsonFields(),
        optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
      ],
    ),
    commandSchema("wait-active", "Wait for a foreground app id.", true, false, [
      argumentField("appId", "string", "Expected foreground Roku application id."),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ]),
    commandSchema("wait-media-player", "Wait for a media-player state.", true, false, [
      argumentField("state", "string", "Expected media-player state."),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ]),
    commandSchema(
      "wait-ready",
      "Wait for active app plus optional node/media readiness.",
      true,
      false,
      [
        argumentField("appId", "string", "Expected foreground Roku application id."),
        optionField("mediaState", "string", "Optional media-player state to wait for."),
        optionField("node", "node-condition", "Optional SceneGraph node condition."),
        optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
      ],
    ),
    commandSchema("screenshot", "Write a timestamped developer screenshot.", true, true, [
      argumentField(
        "outputPath",
        "path",
        "Screenshot base output path inside the current app root.",
      ),
    ]),
  ] satisfies readonly DescribedCommand[],
  globalOptions: [
    globalField("json", "boolean", "Print structured JSON output."),
    globalField("output", "json|text", "Select structured or human output.", false, [
      "json",
      "text",
    ]),
    globalField("dryRun", "boolean", "Validate mutating commands without side effects."),
    globalField("fields", "field-mask", "Comma-separated JSON field mask for output trimming."),
    globalField("inputJson", "json-object", "Command payload matching the described input schema."),
  ],
  schemaVersion: 2,
});

const commandSchema = (
  name: string,
  description: string,
  requiresTarget: boolean,
  mutates: boolean,
  parameters: readonly DescribedField[],
  inputJsonFields: readonly DescribedField[] = parameters,
): DescribedCommand => ({
  description,
  inputJson: {
    fields: [
      {
        description: "Command name.",
        name: "command",
        required: true,
        type: "string",
        values: [name],
      },
      ...inputJsonFields,
    ],
    required: [
      "command",
      ...inputJsonFields.filter((field) => field.required).map((field) => field.name),
    ],
  },
  mutates,
  name,
  parameters,
  requiresTarget,
});

const argumentField = (
  name: string,
  type: string,
  description: string,
  required = true,
  repeatable = false,
  values?: readonly string[],
): DescribedField => ({
  description,
  name,
  repeatable,
  required,
  type,
  values,
});

const optionField = (
  name: string,
  type: string,
  description: string,
  required = false,
  repeatable = false,
  values?: readonly string[],
): DescribedField => ({
  description,
  name,
  repeatable,
  required,
  type,
  values,
});

const globalField = (
  name: string,
  type: string,
  description: string,
  required = false,
  values?: readonly string[],
): DescribedField => ({
  description,
  name,
  required,
  type,
  values,
});

const nodeConditionFields = (): readonly DescribedField[] => [
  argumentField("nodeName", "string", "SceneGraph node name."),
  argumentField(
    "condition",
    "visible|hidden|absent|text|attr",
    "Expected node condition.",
    true,
    false,
    ["visible", "hidden", "absent", "text", "attr"],
  ),
  optionField("value", "string", "Text or attr name=value pair for text/attr conditions."),
];

const nodeConditionInputJsonFields = (): readonly DescribedField[] => [
  argumentField("nodeName", "string", "SceneGraph node name."),
  argumentField(
    "expectation",
    "node-expectation-object",
    "Expected node state, text, or attribute object.",
  ),
];

const printHelp = () => {
  console.log(`rokit - Roku device harness helper

usage:
  rokit describe
  rokit check
  rokit console <output-path> [--duration-ms <ms>]
  rokit debug-command <command> [args...] [--duration-ms <ms>] [--idle-timeout-ms <ms>]
  rokit discover [--timeout-ms <ms>]
  rokit device-info
  rokit active-app
  rokit media-player
  rokit snapshot
  rokit proof <output-dir> [--screenshot]
  rokit package --out <zip-path>
  rokit wait-active <app-id> [--timeout-ms <ms>]
  rokit wait-media-player <state> [--timeout-ms <ms>]
  rokit wait-ready <app-id> [--media-state <state>] [--node <node-name> <condition> [value]] [--timeout-ms <ms>]
  rokit launch <app-id> [--param key=value]
  rokit press [--delay-ms <ms>] [--max <count>] <key> [key...] [--until-node <node-name> <condition> [value]]
  rokit query <ecp-path>
  rokit sgnodes
  rokit assert-node <node-name> <visible|hidden|absent|text|attr> [value]
  rokit wait-node <node-name> <visible|hidden|absent|text|attr> [value] [--timeout-ms <ms>]
  rokit screenshot <output-path>
  rokit install <zip-path>
  rokit --version

global options:
  --json
  --output json | text
  --dry-run
  --fields field[,field...]
  --input-json '<payload>'

environment:
  ROKIT_TARGET=<roku-ip>
  ROKIT_PASSWORD=<developer-mode-password>
  ROKIT_USERNAME=rokudev
  ROKIT_TIMEOUT_MS=10000

aliases:
  ROKU_DEV_TARGET and ROKU_DEV_PASSWORD are accepted when ROKIT_* names are unset.`);
};
