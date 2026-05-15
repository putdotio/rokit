import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import {
  checkDevice,
  getDeviceInfo,
  installPackage,
  launchApp,
  pressKey,
  queryActiveApp,
  queryEcp,
  takeScreenshot,
  type RokuContext,
} from "./roku.js";
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

type Command =
  | { readonly name: "active-app" }
  | { readonly name: "check" }
  | { readonly name: "device-info" }
  | { readonly name: "install"; readonly zipPath: string }
  | { readonly name: "launch"; readonly args: LaunchArgs }
  | { readonly name: "press"; readonly keys: readonly string[] }
  | { readonly name: "query"; readonly path: string }
  | { readonly name: "screenshot"; readonly outputPath: string };

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

  if (command.name === "launch") {
    const app = await launchApp(context, command.args.appId, command.args.params);
    console.log(`launched: ${app.id} ${app.name} ${app.version}`.trim());
    return;
  }

  if (command.name === "press") {
    for (const key of command.keys) {
      await pressKey(context, key);
      console.log(`pressed: ${key}`);
    }
    return;
  }

  if (command.name === "query") {
    console.log(await queryEcp(context, command.path));
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

  if (name === "launch") {
    return { name, args: parseLaunchArgs(args) };
  }

  if (name === "press") {
    if (args.length === 0) {
      fail("usage: rokit press <key> [key...]");
    }

    return { name, keys: args };
  }

  if (name === "query") {
    const path = args[0];

    if (!path) {
      fail("usage: rokit query <ecp-path>");
    }

    return { name, path };
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
  rokit launch <app-id> [--param key=value]
  rokit press <key> [key...]
  rokit query <ecp-path>
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
