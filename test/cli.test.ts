import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectCliCommandNames, parseEffectCliEffect } from "../src/cli-command.js";
import { commandParameter, globalOption } from "../src/cli-command-metadata.js";
import { commandMutates, commandRequiresTarget } from "../src/cli-command-traits.js";
import { describeCli } from "../src/cli-describe.js";
import { runCommandEffect } from "../src/cli-runner.js";
import type { Command, CommandResult } from "../src/cli-types.js";
import { inputJsonCommandNames, parseInputJsonEffect } from "../src/cli-input-json.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtDistDir = resolve(repoRoot, "dist");
const testDistParent = resolve(repoRoot, ".rokit");
mkdirSync(testDistParent, { recursive: true });
const testDistDir = mkdtempSync(join(testDistParent, "cli-test-dist-"));
const cliPath = resolve(testDistDir, "rokit.mjs");
const prepareEffectPath = resolve(repoRoot, "scripts/prepare-effect.sh");

beforeAll(() => {
  cpSync(builtDistDir, testDistDir, { recursive: true });
});

afterAll(() => {
  rmSync(testDistDir, { force: true, recursive: true });
});

type RunRokitOptions = {
  readonly input?: string;
};

const runRokit = (args: string[], options: RunRokitOptions = {}) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: childCliEnv(),
    input: options.input,
  });

const runRokitWithEnv = (args: string[], env: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: childCliEnv(env),
  });

const childCliEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const excludedNames = new Set([
    "NODE_OPTIONS",
    "VITEST",
    "VITEST_POOL_ID",
    "VITEST_WORKER_ID",
    "VITEST_VSCODE",
  ]);
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !excludedNames.has(name)) {
      env[name] = value;
    }
  }

  return { ...env, ...overrides };
};

const parseCliArgs = async (args: readonly string[]) =>
  await Effect.runPromise(parseEffectCliEffect(args));

const runCommand = async (command: Command, dryRun: boolean): Promise<CommandResult> =>
  await Effect.runPromise(
    runCommandEffect(undefined, command, dryRun).pipe(Effect.provide(NodeServices.layer)),
  );

const runParsedCommand = async (args: readonly string[]): Promise<CommandResult> => {
  const parsed = await parseCliArgs(args);
  if (parsed.command === undefined) {
    throw new Error("expected parsed command");
  }

  return await runCommand(parsed.command, parsed.dryRun);
};

const runInputJsonCommand = async (value: string): Promise<CommandResult> =>
  await runCommand(await Effect.runPromise(parseInputJsonEffect(value)), true);

const stringDataField = (result: CommandResult, field: string): string => {
  const data = result.data;
  if (!isRecord(data) || typeof data[field] !== "string") {
    throw new Error(`expected string result data field: ${field}`);
  }

  return data[field];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("rokit cli", () => {
  it("prints help without a device target", () => {
    const result = runRokit(["--help"]);
    const jsonOnly = runRokit(["--json"]);
    const dryRunOnly = runRokit(["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Roku device harness helper");
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("console");
    expect(result.stdout).toContain("debug-command");
    expect(result.stdout).toContain("media-player");
    expect(result.stdout).toContain("wait-node");
    expect(result.stdout).toContain("--output choice");
    expect(result.stderr).toBe("");
    expect(jsonOnly.status).toBe(0);
    expect(jsonOnly.stdout).toContain("USAGE");
    expect(jsonOnly.stderr).toBe("");
    expect(dryRunOnly.status).toBe(0);
    expect(dryRunOnly.stdout).toContain("USAGE");
    expect(dryRunOnly.stderr).toBe("");
  });

  it("prints help for subcommand help without parsing a command", () => {
    const result = runRokit(["describe", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Print machine-readable command schemas.");
    expect(result.stdout).toContain("rokit describe");
    expect(result.stderr).toBe("");
  });

  it("treats help as a global CLI flag", () => {
    const result = runRokit(["assert-node", "status", "text", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Assert one SceneGraph node condition.");
    expect(result.stdout).toContain("<value>");
    expect(result.stdout).not.toContain("--value string");
    expect(result.stderr).toBe("");
  });

  it("prints the package version", () => {
    const result = runRokit(["--version"]);
    const withGlobalFlag = runRokit(["--output", "text", "--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^rokit v\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
    expect(withGlobalFlag.status).toBe(0);
    expect(withGlobalFlag.stdout.trim()).toBe(result.stdout.trim());
    expect(withGlobalFlag.stderr).toBe("");
  });

  it("uses Effect CLI action-flag semantics before the argument terminator", () => {
    const shortVersionOperand = runRokit(["assert-node", "title", "text", "-v"]);
    const longVersionOperand = runRokit(["assert-node", "title", "text", "--version", "--json"]);
    const trailingHelpOperand = runRokit(["assert-node", "title", "text", "--", "--help"]);

    expect(shortVersionOperand.status).toBe(1);
    expect(JSON.parse(shortVersionOperand.stderr)).toEqual({
      error: { message: "Unrecognized flag: -v in command rokit assert-node" },
      status: "failed",
    });
    expect(shortVersionOperand.stdout.trim()).not.toMatch(/^\d+\.\d+\.\d+/);

    expect(longVersionOperand.status).toBe(0);
    expect(longVersionOperand.stdout.trim()).toMatch(/^rokit v\d+\.\d+\.\d+/);
    expect(longVersionOperand.stderr).toBe("");

    expect(trailingHelpOperand.status).toBe(1);
    expect(JSON.parse(trailingHelpOperand.stderr)).toEqual({
      error: { message: "usage: rokit assert-node <node-name> text <expected-text>" },
      status: "failed",
    });
    expect(trailingHelpOperand.stdout).not.toContain("USAGE");
  });

  it("accepts node assertion values as positional arguments", () => {
    const textValue = runRokit(["--json", "assert-node", "title", "text", "plain"]);
    const duplicateValue = runRokit(["--json", "assert-node", "title", "text", "plain", "extra"]);

    expect(textValue.status).toBe(1);
    expect(JSON.parse(textValue.stderr)).toEqual({
      error: { message: "ROKIT_TARGET is not set" },
      status: "failed",
    });
    expect(duplicateValue.status).toBe(1);
    expect(JSON.parse(duplicateValue.stderr)).toEqual({
      error: { message: "Unexpected extra argument: extra" },
      status: "failed",
    });
  });

  it("reports missing target without a stack trace", () => {
    const result = runRokit(["--output", "text", "check"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ROKIT_TARGET is not set");
    expect(result.stderr).not.toContain("Error:");
  });

  it("defaults to structured JSON for non-TTY command output", () => {
    const result = runRokit(["check"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "ROKIT_TARGET is not set" },
      status: "failed",
    });
    expect(result.stdout).toBe("");
  });

  it("describes the machine-readable command surface without a device target", () => {
    const result = runRokit(["describe"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("ok");
    expect(Object.keys(parsed.data).sort()).toEqual([
      "automation",
      "commands",
      "globalOptions",
      "schemaVersion",
    ]);
    expect(parsed.data.schemaVersion).toBe(5);
    expect(parsed.data.automation).toMatchObject({
      dryRun: true,
      inputJson: true,
      nonTtyJsonDefault: true,
      outputFields: true,
    });
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({ name: "proof", requiresTarget: true }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        name: "console",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "output-path", required: true, type: "path" }),
          expect.objectContaining({ name: "duration-ms", required: false }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        mutates: true,
        name: "debug-command",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "command", required: true }),
          expect.objectContaining({ name: "args", repeatable: true }),
          expect.objectContaining({ name: "idle-timeout-ms", required: false }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          required: expect.arrayContaining(["command", "outputDir"]),
        }),
        name: "proof",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "output-dir", required: true, type: "path" }),
          expect.objectContaining({ name: "screenshot", required: false, type: "boolean" }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: "expectation",
              type: "node-expectation-object",
            }),
          ]),
        }),
        name: "assert-node",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "node-name", required: true }),
          expect.objectContaining({ name: "condition", type: "visible|hidden|absent|text|attr" }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "appId", required: true }),
            expect.objectContaining({ name: "params", required: false }),
          ]),
        }),
        name: "launch",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "app-id", required: true }),
          expect.objectContaining({ name: "param", repeatable: true, type: "key=value" }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        name: "wait-ready",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "app-id", required: true }),
          expect.objectContaining({ name: "node-name", required: false }),
          expect.objectContaining({ name: "condition", required: false }),
          expect.objectContaining({ name: "value", required: false }),
        ]),
      }),
    );
    expect(parsed.data.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "delayMs", type: "non-negative-integer" }),
          ]),
        }),
        name: "press",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "delay-ms", type: "non-negative-integer" }),
        ]),
      }),
    );
    expect(parsed.data.globalOptions).toContainEqual(
      expect.objectContaining({ name: "fields", type: "field-mask" }),
    );
    expect(parsed.data.globalOptions).toContainEqual(
      expect.objectContaining({ name: "input-json", type: "json-source" }),
    );
  });

  it("keeps parser, input-json, and describe command surfaces aligned", () => {
    const description = describeCli();

    if (description === undefined) {
      throw new Error("expected rokit description");
    }

    const describedCommandNames = description.commands.map((command) => command.name).sort();

    expect(describedCommandNames).toEqual([...effectCliCommandNames()].sort());
    expect(describedCommandNames).toEqual([...inputJsonCommandNames].sort());
  });

  it("keeps Effect CLI help text backed by described field metadata", () => {
    const rootHelp = runRokit(["--help"]);
    const packageHelp = runRokit(["package", "--help"]);
    const pressHelp = runRokit(["press", "--help"]);
    const waitReadyHelp = runRokit(["wait-ready", "--help"]);

    expect(rootHelp.status).toBe(0);
    expect(packageHelp.status).toBe(0);
    expect(pressHelp.status).toBe(0);
    expect(waitReadyHelp.status).toBe(0);

    expect(rootHelp.stdout).toContain(globalOption("fields").description);
    expect(rootHelp.stdout).toContain(globalOption("input-json").description);
    expect(packageHelp.stdout).toContain(commandParameter("package", "zip-path").description);
    expect(pressHelp.stdout).toContain(commandParameter("press", "key").description);
    expect(pressHelp.stdout).toContain(commandParameter("press", "until-node").description);
    expect(waitReadyHelp.stdout).toContain(commandParameter("wait-ready", "app-id").description);
    expect(waitReadyHelp.stdout).toContain(
      commandParameter("wait-ready", "media-state").description,
    );
  });

  it("keeps described command traits backed by shared command metadata", () => {
    const description = describeCli();

    if (description === undefined) {
      throw new Error("expected rokit description");
    }

    for (const command of description.commands) {
      expect(command.requiresTarget, `${command.name} target trait`).toBe(
        commandRequiresTarget(command.name),
      );
      expect(command.mutates, `${command.name} mutation trait`).toBe(commandMutates(command.name));
    }
  });

  it("describes a single command schema for context-window control", () => {
    const result = runRokit(["describe", "proof"]);
    const inputJsonResult = runRokit([
      "--input-json",
      JSON.stringify({ command: "describe", commandName: "press" }),
    ]);
    const unknownResult = runRokit(["describe", "nope"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "describe",
      data: {
        commands: [
          {
            name: "proof",
            parameters: expect.arrayContaining([
              expect.objectContaining({ name: "output-dir", required: true }),
            ]),
          },
        ],
        schemaVersion: 5,
      },
      status: "ok",
    });
    expect(JSON.parse(result.stdout).data.commands).toHaveLength(1);

    expect(inputJsonResult.status).toBe(0);
    expect(JSON.parse(inputJsonResult.stdout).data.commands).toEqual([
      expect.objectContaining({ name: "press" }),
    ]);

    expect(unknownResult.status).toBe(1);
    expect(JSON.parse(unknownResult.stderr)).toEqual({
      error: { message: "Unknown described command: nope" },
      status: "failed",
    });
  });

  it("does not parse device env for target-free commands", () => {
    const describeResult = runRokitWithEnv(["describe"], { ROKIT_TIMEOUT_MS: "bad" });
    const dryRunResult = runRokitWithEnv(["--dry-run", "launch", "dev"], {
      ROKIT_TIMEOUT_MS: "bad",
    });

    expect(describeResult.status).toBe(0);
    expect(JSON.parse(describeResult.stdout)).toMatchObject({
      command: "describe",
      status: "ok",
    });
    expect(dryRunResult.status).toBe(0);
    expect(JSON.parse(dryRunResult.stdout)).toMatchObject({
      command: "launch",
      dryRun: true,
      status: "ok",
    });
  });

  it("supports dry-run for mutating commands without requiring a target", async () => {
    const result = await runParsedCommand([
      "--dry-run",
      "launch",
      "dev",
      "--param",
      "source=synthetic",
      "--param",
      "story=app-dialog-empty",
    ]);
    const launchParamWithEquals = await runParsedCommand([
      "--dry-run",
      "launch",
      "dev",
      "--param",
      "token=abc==",
    ]);
    const discoverResult = await runParsedCommand(["--dry-run", "discover", "--timeout-ms", "250"]);
    const packageResult = await runParsedCommand(["--dry-run", "package", "out/channel"]);
    const proofResult = await runParsedCommand(["--dry-run", "proof", "artifacts/proof"]);
    const reorderedProofResult = await runParsedCommand([
      "--dry-run",
      "proof",
      "artifacts/proof",
      "--screenshot",
    ]);
    const consoleResult = await runParsedCommand([
      "--dry-run",
      "console",
      "artifacts/debug/console.log",
      "--duration-ms",
      "250",
    ]);
    const debugCommandResult = await runParsedCommand(["--dry-run", "debug-command", "help"]);

    expect(result).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { source: "synthetic", story: "app-dialog-empty" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(launchParamWithEquals).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { token: "abc==" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(discoverResult).toMatchObject({
      command: "discover",
      data: { timeoutMs: 250 },
      dryRun: true,
      status: "ok",
    });
    expect(packageResult).toMatchObject({
      command: "package",
      data: { path: resolve(repoRoot, "out/channel.zip") },
      dryRun: true,
      status: "ok",
    });
    expect(proofResult).toMatchObject({
      command: "proof",
      data: { outputDir: resolve(repoRoot, "artifacts/proof") },
      dryRun: true,
      status: "ok",
    });
    expect(reorderedProofResult).toMatchObject({
      command: "proof",
      data: {
        outputDir: resolve(repoRoot, "artifacts/proof"),
        screenshot: true,
      },
      dryRun: true,
      status: "ok",
    });
    expect(consoleResult).toMatchObject({
      command: "console",
      data: {
        durationMs: 250,
        port: 8085,
      },
      dryRun: true,
      status: "ok",
    });
    expect(debugCommandResult).toMatchObject({
      command: "debug-command",
      data: {
        command: "help",
      },
      dryRun: true,
      status: "ok",
    });
  });

  it("validates package dry-run output safety before reporting success", async () => {
    await expect(runParsedCommand(["--dry-run", "package", "source/channel"])).rejects.toThrow(
      `package output path must be outside packaged roots: ${resolve(repoRoot, "source/channel.zip")}`,
    );
  });

  it("validates dry-run command payloads like live command payloads", async () => {
    const zeroDelayPress = await runParsedCommand([
      "--dry-run",
      "press",
      "Down",
      "--delay-ms",
      "0",
    ]);
    const cappedPress = await runParsedCommand([
      "--dry-run",
      "press",
      "Down",
      "--until-node",
      "videoPlayerScreen",
      "--until-state",
      "visible",
      "--max",
      "2",
    ]);

    expect(zeroDelayPress).toMatchObject({
      command: "press",
      data: { delayMs: 0 },
      dryRun: true,
      status: "ok",
    });
    expect(cappedPress).toMatchObject({
      command: "press",
      data: { maxAttempts: 2 },
      dryRun: true,
      status: "ok",
    });
    await expect(
      parseCliArgs([
        "--dry-run",
        "press",
        "--max",
        "2",
        "Down",
        "--until-node",
        "videoPlayerScreen",
        "visible",
      ]),
    ).rejects.toThrow("unsupported remote key: visible");
    await expect(
      runParsedCommand(["--json", "wait-ready", "dev", "title", "text", "Rokit"]),
    ).rejects.toThrow("ROKIT_TARGET is not set");
    await expect(parseCliArgs(["--dry-run", "launch", "dev", "--param", "nope"])).rejects.toThrow(
      'Invalid --param value "nope". Expected key=value.',
    );
    await expect(parseCliArgs(["--dry-run", "press", "Bogus"])).rejects.toThrow(
      "unsupported remote key: Bogus",
    );
    await expect(parseCliArgs(["--json", "debug-command", "bogus"])).rejects.toThrow(
      "Unsupported Roku debug command: bogus",
    );
    await expect(
      parseCliArgs(["--dry-run", "press", "Down", "--until-state", "hidden"]),
    ).rejects.toThrow("usage: rokit press --until-node <node-name>");
    await expect(parseCliArgs(["wait-ready", "dev", "--node-state", "hidden"])).rejects.toThrow(
      "Unrecognized flag: --node-state in command rokit wait-ready",
    );
  });

  it("keeps wait-ready node timeout scoped to the node condition", async () => {
    const parsed = await parseCliArgs([
      "wait-ready",
      "dev",
      "videoPlayerScreen",
      "--node-timeout-ms",
      "250",
    ]);

    expect(parsed.command).toMatchObject({
      appId: "dev",
      name: "wait-ready",
      node: {
        nodeName: "videoPlayerScreen",
        expectation: { state: "visible" },
        timeoutMs: 250,
      },
      timeoutMs: undefined,
    });
  });

  it("uses positional node conditions for wait-ready", async () => {
    const parsed = await parseCliArgs(["wait-ready", "dev", "title", "text", "Rokit"]);

    expect(parsed.command).toMatchObject({
      appId: "dev",
      name: "wait-ready",
      node: {
        expectation: { state: "visible", text: "Rokit" },
        nodeName: "title",
      },
    });
  });

  it("accepts typed JSON payloads", async () => {
    const result = await runInputJsonCommand(
      JSON.stringify({ command: "press", delayMs: 0, keys: ["Down", "Select"] }),
    );

    expect(result).toMatchObject({
      command: "press",
      data: {
        delayMs: 0,
        keys: ["Down", "Select"],
      },
      dryRun: true,
    });
  });

  it("accepts typed JSON payloads from files and stdin", () => {
    const payloadPath = join(testDistDir, "input-payload.json");
    writeFileSync(payloadPath, JSON.stringify({ command: "press", delayMs: 0, keys: ["Down"] }));

    const fromFile = runRokit(["--dry-run", "--input-json", `@${payloadPath}`]);
    const fromStdin = runRokit(["--dry-run", "--input-json", "-"], {
      input: JSON.stringify({ command: "press", keys: ["Back"] }),
    });

    expect(fromFile.status).toBe(0);
    expect(JSON.parse(fromFile.stdout)).toMatchObject({
      command: "press",
      data: {
        delayMs: 0,
        keys: ["Down"],
      },
      dryRun: true,
      status: "ok",
    });
    expect(fromStdin.status).toBe(0);
    expect(JSON.parse(fromStdin.stdout)).toMatchObject({
      command: "press",
      data: {
        keys: ["Back"],
      },
      dryRun: true,
      status: "ok",
    });
  });

  it("accepts raw JSON payloads for mutating command schemas", async () => {
    const [launch, proof, pack] = await Promise.all([
      runInputJsonCommand(
        JSON.stringify({
          appId: "dev",
          command: "launch",
          params: { story: "app-dialog-empty", token: "abc==" },
        }),
      ),
      runInputJsonCommand(
        JSON.stringify({ command: "proof", outputDir: "artifacts/proof", screenshot: true }),
      ),
      runInputJsonCommand(JSON.stringify({ command: "package", outputPath: "out/channel" })),
    ]);

    expect(launch).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { story: "app-dialog-empty", token: "abc==" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(proof).toMatchObject({
      command: "proof",
      data: {
        outputDir: resolve(repoRoot, "artifacts/proof"),
        screenshot: true,
      },
      dryRun: true,
      status: "ok",
    });
    expect(pack).toMatchObject({
      command: "package",
      data: { path: resolve(repoRoot, "out/channel.zip") },
      dryRun: true,
      status: "ok",
    });
  });

  it("rejects mixed input-json and positional command arguments", () => {
    const result = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ appId: "dev", command: "launch" }),
      "press",
      "Down",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "usage: rokit --input-json <json|@file|->" },
      status: "failed",
    });
  });

  it("reports malformed input-json before command dispatch", () => {
    const result = runRokit(["--dry-run", "--input-json", "{"]);
    const missingFile = runRokit(["--dry-run", "--input-json", "@"]);
    const invalidDiscoverTimeout = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ command: "discover", timeoutMs: 0 }),
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "input JSON must be valid JSON" },
      status: "failed",
    });
    expect(missingFile.status).toBe(1);
    expect(JSON.parse(missingFile.stderr)).toEqual({
      error: { message: "--input-json @file requires a file path" },
      status: "failed",
    });
    expect(invalidDiscoverTimeout.status).toBe(1);
    expect(JSON.parse(invalidDiscoverTimeout.stderr)).toEqual({
      error: { message: "input JSON field must be a positive integer: timeoutMs" },
      status: "failed",
    });
  });

  it("matches JSON press defaults to the CLI press surface", async () => {
    const result = await runInputJsonCommand(
      JSON.stringify({
        command: "press",
        keys: ["Down"],
        until: {
          expectation: { state: "visible" },
          nodeName: "videoPlayerScreen",
        },
      }),
    );

    expect(result).toMatchObject({
      command: "press",
      data: { maxAttempts: 8 },
      dryRun: true,
      status: "ok",
    });
  });

  it("keeps required JSON payload fields aligned with CLI arguments", async () => {
    await expect(
      Effect.runPromise(parseInputJsonEffect('{"command":"press","keys":[]}')),
    ).rejects.toThrow("input JSON field must include at least one key: keys");
  });

  it("filters JSON output with field masks", () => {
    const result = runRokit(["--dry-run", "--fields", "status,data.appId", "launch", "dev"]);
    const missingField = runRokit(["--dry-run", "--fields", "data.missing", "launch", "dev"]);
    const arrayField = runRokit([
      "--fields",
      "status,data.commands.0.name,data.commands.0.parameters.0.name",
      "describe",
      "press",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      data: { appId: "dev" },
      status: "ok",
    });
    expect(missingField.status).toBe(0);
    expect(JSON.parse(missingField.stdout)).toEqual({
      status: "ok",
    });
    expect(arrayField.status).toBe(0);
    expect(JSON.parse(arrayField.stdout)).toEqual({
      data: {
        commands: [
          {
            name: "press",
            parameters: [{ name: "key" }],
          },
        ],
      },
      status: "ok",
    });
  });

  it("preserves structured JSON errors when field masks are present", () => {
    const result = runRokit(["--fields", "data.appId", "check"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "ROKIT_TARGET is not set" },
      status: "failed",
    });
    expect(result.stdout).toBe("");
  });

  it("hardens ECP paths for agent mistakes", async () => {
    await expect(runParsedCommand(["--dry-run", "query", "/query/active-app?x=1"])).rejects.toThrow(
      "ECP path must not include query strings or fragments",
    );
    await expect(
      runParsedCommand(["--dry-run", "query", "//example.com/query/device-info"]),
    ).rejects.toThrow("ECP path must be device-relative");
    await expect(
      runParsedCommand(["--dry-run", "query", "\\\\example.com/query/device-info"]),
    ).rejects.toThrow("ECP path must not include backslashes");
    await expect(
      runParsedCommand(["--dry-run", "query", "/\\example.com/query/device-info"]),
    ).rejects.toThrow("ECP path must not include backslashes");
  });

  it("hardens output paths for agent mistakes", async () => {
    await expect(runParsedCommand(["--dry-run", "screenshot", "../outside.png"])).rejects.toThrow(
      "screenshot output path must stay within the current working directory",
    );
    await expect(runParsedCommand(["--dry-run", "screenshot", "."])).rejects.toThrow(
      "screenshot output path must name a file within the current working directory",
    );
    await expect(runParsedCommand(["--dry-run", "package", "."])).rejects.toThrow(
      "package output path must name a file within the current working directory",
    );
    await expect(runParsedCommand(["--dry-run", "proof", "first", "second"])).rejects.toThrow(
      "Unexpected extra argument: second",
    );
    await expect(runParsedCommand(["--dry-run", "package", "out/one", "out/two"])).rejects.toThrow(
      "Unexpected extra argument: out/two",
    );
  });

  it("timestamps screenshot output paths", async () => {
    const result = await runParsedCommand(["--dry-run", "screenshot", "artifacts/lab/story.jpg"]);

    const path = stringDataField(result, "path");

    expect(result.data).toMatchObject({
      path: expect.stringMatching(/story-\d{8}-\d{6}-\d{3}\.jpg$/),
    });
    expect(path).not.toBe(resolve(repoRoot, "artifacts/lab/story.jpg"));
    expect(path).toContain(`${resolve(repoRoot, "artifacts/lab")}/`);
  });

  it("keeps partial observation metadata visible through field masks", () => {
    const result = runRokitWithEnv(["--fields", "data.activeApp", "snapshot"], {
      ROKIT_TARGET: "127.0.0.1",
      ROKIT_TIMEOUT_MS: "100",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      failedObservations: expect.arrayContaining(["activeApp", "device", "mediaPlayer"]),
      partial: true,
      status: "ok",
    });
  });

  it("reports invalid global output mode as structured JSON", () => {
    const result = runRokit(["--json", "--output", "yaml", "check"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        message:
          'Invalid value for flag --output: "yaml". Expected: Expected "json" | "text", got "yaml"',
      },
      status: "failed",
    });
    expect(result.stdout).toBe("");
  });

  it("does not clone the local Effect checkout in CI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rokit-effect-ci-"));
    const result = spawnSync(prepareEffectPath, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(join(cwd, ".repos"))).toBe(false);
  });
});
