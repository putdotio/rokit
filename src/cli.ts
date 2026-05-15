import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import {
  assertSceneGraphNode,
  checkDevice,
  getDeviceInfo,
  installPackage,
  launchApp,
  pressKey,
  queryActiveApp,
  queryEcp,
  querySceneGraph,
  takeScreenshot,
  waitForActiveApp,
  waitForSceneGraphNode,
  type RokuContext,
} from "./roku.js";
import type { NodeExpectation } from "./scenegraph.js";
import {
  fail,
  formatErrorMessage,
  loadEnv,
  loadLocalEnv,
  requirePassword,
  requireTarget,
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
};

type Command =
  | { readonly name: "active-app" }
  | { readonly args: NodeCondition; readonly name: "assert-node" }
  | { readonly name: "check" }
  | { readonly name: "device-info" }
  | { readonly name: "install"; readonly zipPath: string }
  | { readonly name: "launch"; readonly args: LaunchArgs }
  | { readonly args: PressArgs; readonly name: "press" }
  | { readonly name: "query"; readonly path: string }
  | { readonly name: "screenshot"; readonly outputPath: string }
  | { readonly name: "sgnodes" }
  | { readonly appId: string; readonly name: "wait-active"; readonly timeoutMs?: number }
  | { readonly args: NodeCondition; readonly name: "wait-node" };

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  const firstArg = argv[0];

  if (!firstArg || firstArg === "--help" || firstArg === "-h") {
    printHelp();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    console.log(packageJson.version);
    return;
  }

  loadLocalEnv();

  const env = loadEnv();
  const target = requireTarget(env);
  const context: RokuContext = {
    password: env.password,
    target,
    timeoutMs: env.timeoutMs,
    username: env.username,
  };
  const command = parseCommand(argv);

  try {
    await runCommand(context, command);
  } catch (error) {
    fail(formatErrorMessage(error));
  }
};

const runCommand = async (context: RokuContext, command: Command): Promise<void> => {
  if (command.name === "check") {
    const summary = await checkDevice(context);
    console.log(`device: ${summary.name} (${summary.model})`);
    console.log(`ecp: ${summary.ecp}`);
    console.log(`developer installer HTTP status: ${summary.installerStatus}`);
    return;
  }

  if (command.name === "device-info") {
    console.log(JSON.stringify(await getDeviceInfo(context), null, 2));
    return;
  }

  if (command.name === "active-app") {
    const app = await queryActiveApp(context);
    console.log(`active app: ${app.id} ${app.name} ${app.version}`.trim());
    return;
  }

  if (command.name === "wait-active") {
    const app = await waitForActiveApp(context, command.appId, command.timeoutMs);
    console.log(`active app: ${app.id} ${app.name} ${app.version}`.trim());
    return;
  }

  if (command.name === "launch") {
    const app = await launchApp(context, command.args.appId, command.args.params);
    console.log(`launched: ${app.id} ${app.name} ${app.version}`.trim());
    return;
  }

  if (command.name === "press") {
    for (const [index, key] of command.args.keys.entries()) {
      if (index > 0 && command.args.delayMs > 0) {
        await sleep(command.args.delayMs);
      }

      await pressKey(context, key);
      console.log(`pressed: ${key}`);
    }
    return;
  }

  if (command.name === "query") {
    console.log(await queryEcp(context, command.path));
    return;
  }

  if (command.name === "sgnodes") {
    console.log(await querySceneGraph(context));
    return;
  }

  if (command.name === "assert-node") {
    await assertSceneGraphNode(context, command.args.nodeName, command.args.expectation);
    console.log(`asserted node: ${formatNodeCondition(command.args)}`);
    return;
  }

  if (command.name === "wait-node") {
    await waitForSceneGraphNode(
      context,
      command.args.nodeName,
      command.args.expectation,
      command.args.timeoutMs,
    );
    console.log(`matched node: ${formatNodeCondition(command.args)}`);
    return;
  }

  if (command.name === "screenshot") {
    const password = requirePassword(context);
    mkdirSync(dirname(command.outputPath), { recursive: true });
    console.log(
      `screenshot: ${await takeScreenshot({ ...context, password }, command.outputPath)}`,
    );
    return;
  }

  if (command.name === "install") {
    const password = requirePassword(context);
    console.log(await installPackage({ ...context, password }, command.zipPath));
  }
};

const parseCommand = (argv: readonly string[]): Command => {
  const [name, ...args] = argv;

  if (name === "check") {
    return { name };
  }

  if (name === "device-info") {
    return { name };
  }

  if (name === "active-app") {
    return { name };
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
  const keys: string[] = [];

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

  return { delayMs, keys };
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

const printHelp = () => {
  console.log(`rokit - Roku device harness helper

usage:
  rokit check
  rokit device-info
  rokit active-app
  rokit wait-active <app-id> [--timeout-ms <ms>]
  rokit launch <app-id> [--param key=value]
  rokit press [--delay-ms <ms>] <key> [key...]
  rokit query <ecp-path>
  rokit sgnodes
  rokit assert-node <node-name> <visible|hidden|absent|text|attr> [value]
  rokit wait-node <node-name> <visible|hidden|absent|text|attr> [value] [--timeout-ms <ms>]
  rokit screenshot <output-path>
  rokit install <zip-path>
  rokit --version

environment:
  ROKIT_TARGET=<roku-ip>
  ROKIT_PASSWORD=<developer-mode-password>
  ROKIT_USERNAME=rokudev
  ROKIT_TIMEOUT_MS=10000

compatibility:
  ROKU_DEV_TARGET and ROKU_DEV_PASSWORD are accepted as fallbacks.`);
};
