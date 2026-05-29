import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectCliCommandNames, parseEffectCliEffect } from "../src/cli-command.js";
import { commandParameter, globalOption } from "../src/cli-command-metadata.js";
import { commandMutates, commandRequiresTarget } from "../src/cli-command-traits.js";
import { describeCli } from "../src/cli-describe.js";
import { inputJsonCommandNames } from "../src/cli-input-json.js";

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

  it("supports dry-run for mutating commands without requiring a target", () => {
    const result = runRokit([
      "--dry-run",
      "launch",
      "dev",
      "--param",
      "source=synthetic",
      "--param",
      "story=app-dialog-empty",
    ]);
    const launchParamWithEquals = runRokit([
      "--dry-run",
      "launch",
      "dev",
      "--param",
      "token=abc==",
    ]);
    const discoverResult = runRokit(["--dry-run", "discover", "--timeout-ms", "250"]);
    const packageResult = runRokit(["--dry-run", "package", "out/channel"]);
    const proofResult = runRokit(["--dry-run", "proof", "artifacts/proof"]);
    const reorderedProofResult = runRokit([
      "--dry-run",
      "proof",
      "artifacts/proof",
      "--screenshot",
    ]);
    const consoleResult = runRokit([
      "--dry-run",
      "console",
      "artifacts/debug/console.log",
      "--duration-ms",
      "250",
    ]);
    const debugCommandResult = runRokit(["--dry-run", "debug-command", "help"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { source: "synthetic", story: "app-dialog-empty" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(launchParamWithEquals.status).toBe(0);
    expect(JSON.parse(launchParamWithEquals.stdout)).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { token: "abc==" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(discoverResult.status).toBe(0);
    expect(JSON.parse(discoverResult.stdout)).toMatchObject({
      command: "discover",
      data: { timeoutMs: 250 },
      dryRun: true,
      status: "ok",
    });
    expect(packageResult.status).toBe(0);
    expect(JSON.parse(packageResult.stdout)).toMatchObject({
      command: "package",
      data: { path: resolve(repoRoot, "out/channel.zip") },
      dryRun: true,
      status: "ok",
    });
    expect(proofResult.status).toBe(0);
    expect(JSON.parse(proofResult.stdout)).toMatchObject({
      command: "proof",
      data: { outputDir: resolve(repoRoot, "artifacts/proof") },
      dryRun: true,
      status: "ok",
    });
    expect(reorderedProofResult.status).toBe(0);
    expect(JSON.parse(reorderedProofResult.stdout)).toMatchObject({
      command: "proof",
      data: {
        outputDir: resolve(repoRoot, "artifacts/proof"),
        screenshot: true,
      },
      dryRun: true,
      status: "ok",
    });
    expect(consoleResult.status).toBe(0);
    expect(JSON.parse(consoleResult.stdout)).toMatchObject({
      command: "console",
      data: {
        durationMs: 250,
        port: 8085,
      },
      dryRun: true,
      status: "ok",
    });
    expect(debugCommandResult.status).toBe(0);
    expect(JSON.parse(debugCommandResult.stdout)).toMatchObject({
      command: "debug-command",
      data: {
        command: "help",
      },
      dryRun: true,
      status: "ok",
    });
  });

  it("validates package dry-run output safety before reporting success", () => {
    const result = runRokit(["--dry-run", "package", "source/channel"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        message: `package output path must be outside packaged roots: ${resolve(repoRoot, "source/channel.zip")}`,
      },
      status: "failed",
    });
  });

  it("validates dry-run command payloads like live command payloads", () => {
    const zeroDelayPress = runRokit(["--dry-run", "press", "Down", "--delay-ms", "0"]);
    const cappedPress = runRokit([
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
    const positionalUntilState = runRokit([
      "--dry-run",
      "press",
      "--max",
      "2",
      "Down",
      "--until-node",
      "videoPlayerScreen",
      "visible",
    ]);
    const waitReadyNodeCondition = runRokit([
      "--json",
      "wait-ready",
      "dev",
      "title",
      "text",
      "Rokit",
    ]);
    const invalidLaunchParam = runRokit(["--dry-run", "launch", "dev", "--param", "nope"]);
    const invalidPress = runRokit(["--dry-run", "press", "Bogus"]);
    const invalidDebugCommand = runRokit(["--json", "debug-command", "bogus"]);

    expect(zeroDelayPress.status).toBe(0);
    expect(JSON.parse(zeroDelayPress.stdout)).toMatchObject({
      command: "press",
      data: { delayMs: 0 },
      dryRun: true,
      status: "ok",
    });
    expect(cappedPress.status).toBe(0);
    expect(JSON.parse(cappedPress.stdout)).toMatchObject({
      command: "press",
      data: { maxAttempts: 2 },
      dryRun: true,
      status: "ok",
    });
    expect(positionalUntilState.status).toBe(1);
    expect(JSON.parse(positionalUntilState.stderr)).toEqual({
      error: {
        message:
          'Invalid value for argument <key>: "visible". Expected: unsupported remote key: visible',
      },
      status: "failed",
    });
    expect(waitReadyNodeCondition.status).toBe(1);
    expect(JSON.parse(waitReadyNodeCondition.stderr)).toEqual({
      error: { message: "ROKIT_TARGET is not set" },
      status: "failed",
    });
    expect(invalidLaunchParam.status).toBe(1);
    expect(JSON.parse(invalidLaunchParam.stderr)).toEqual({
      error: {
        message:
          'Invalid value for flag --param: "nope". Expected: Invalid --param value "nope". Expected key=value.',
      },
      status: "failed",
    });
    expect(invalidPress.status).toBe(1);
    expect(JSON.parse(invalidPress.stderr)).toEqual({
      error: {
        message:
          'Invalid value for argument <key>: "Bogus". Expected: unsupported remote key: Bogus',
      },
      status: "failed",
    });
    expect(invalidDebugCommand.status).toBe(1);
    expect(JSON.parse(invalidDebugCommand.stderr)).toEqual({
      error: { message: "Unsupported Roku debug command: bogus" },
      status: "failed",
    });

    const danglingUntilState = runRokit(["--dry-run", "press", "Down", "--until-state", "hidden"]);
    const oldWaitReadyNodeFlag = runRokit(["wait-ready", "dev", "--node-state", "hidden"]);

    expect(danglingUntilState.status).toBe(1);
    expect(JSON.parse(danglingUntilState.stderr)).toEqual({
      error: { message: "usage: rokit press --until-node <node-name>" },
      status: "failed",
    });
    expect(oldWaitReadyNodeFlag.status).toBe(1);
    expect(JSON.parse(oldWaitReadyNodeFlag.stderr)).toEqual({
      error: { message: "Unrecognized flag: --node-state in command rokit wait-ready" },
      status: "failed",
    });
  });

  it("keeps wait-ready node timeout scoped to the node condition", async () => {
    const parsed = await Effect.runPromise(
      parseEffectCliEffect(["wait-ready", "dev", "videoPlayerScreen", "--node-timeout-ms", "250"]),
    );

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
    const parsed = await Effect.runPromise(
      parseEffectCliEffect(["wait-ready", "dev", "title", "text", "Rokit"]),
    );

    expect(parsed.command).toMatchObject({
      appId: "dev",
      name: "wait-ready",
      node: {
        expectation: { state: "visible", text: "Rokit" },
        nodeName: "title",
      },
    });
  });

  it("accepts typed JSON payloads", () => {
    const result = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ command: "press", delayMs: 0, keys: ["Down", "Select"] }),
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
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

  it("accepts raw JSON payloads for mutating command schemas", () => {
    const launch = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({
        appId: "dev",
        command: "launch",
        params: { story: "app-dialog-empty", token: "abc==" },
      }),
    ]);
    const proof = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ command: "proof", outputDir: "artifacts/proof", screenshot: true }),
    ]);
    const pack = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ command: "package", outputPath: "out/channel" }),
    ]);

    expect(launch.status).toBe(0);
    expect(JSON.parse(launch.stdout)).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { story: "app-dialog-empty", token: "abc==" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(proof.status).toBe(0);
    expect(JSON.parse(proof.stdout)).toMatchObject({
      command: "proof",
      data: {
        outputDir: resolve(repoRoot, "artifacts/proof"),
        screenshot: true,
      },
      dryRun: true,
      status: "ok",
    });
    expect(pack.status).toBe(0);
    expect(JSON.parse(pack.stdout)).toMatchObject({
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

  it("matches JSON press defaults to the CLI press surface", () => {
    const result = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({
        command: "press",
        keys: ["Down"],
        until: {
          expectation: { state: "visible" },
          nodeName: "videoPlayerScreen",
        },
      }),
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "press",
      data: { maxAttempts: 8 },
      dryRun: true,
      status: "ok",
    });
  });

  it("keeps required JSON payload fields aligned with CLI arguments", () => {
    const result = runRokit(["--dry-run", "--input-json", '{"command":"press","keys":[]}']);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "input JSON field must include at least one key: keys" },
      status: "failed",
    });
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

  it("hardens ECP paths for agent mistakes", () => {
    const badQuery = runRokit(["--dry-run", "query", "/query/active-app?x=1"]);
    const protocolRelativeQuery = runRokit([
      "--dry-run",
      "query",
      "//example.com/query/device-info",
    ]);
    const backslashHostQuery = runRokit([
      "--dry-run",
      "query",
      "\\\\example.com/query/device-info",
    ]);
    const slashBackslashHostQuery = runRokit([
      "--dry-run",
      "query",
      "/\\example.com/query/device-info",
    ]);

    expect(badQuery.status).toBe(1);
    expect(JSON.parse(badQuery.stderr).error.message).toBe(
      "ECP path must not include query strings or fragments",
    );
    expect(protocolRelativeQuery.status).toBe(1);
    expect(JSON.parse(protocolRelativeQuery.stderr).error.message).toBe(
      "ECP path must be device-relative",
    );
    expect(backslashHostQuery.status).toBe(1);
    expect(JSON.parse(backslashHostQuery.stderr).error.message).toBe(
      "ECP path must not include backslashes",
    );
    expect(slashBackslashHostQuery.status).toBe(1);
    expect(JSON.parse(slashBackslashHostQuery.stderr).error.message).toBe(
      "ECP path must not include backslashes",
    );
  });

  it("hardens output paths for agent mistakes", () => {
    const badScreenshot = runRokit(["--dry-run", "screenshot", "../outside.png"]);
    const cwdScreenshotOutput = runRokit(["--dry-run", "screenshot", "."]);
    const cwdPackageOutput = runRokit(["--dry-run", "package", "."]);
    const duplicateProofOutput = runRokit(["--dry-run", "proof", "first", "second"]);
    const duplicatePackageOutput = runRokit(["--dry-run", "package", "out/one", "out/two"]);

    expect(badScreenshot.status).toBe(1);
    expect(JSON.parse(badScreenshot.stderr).error.message).toBe(
      "screenshot output path must stay within the current working directory",
    );
    expect(cwdScreenshotOutput.status).toBe(1);
    expect(JSON.parse(cwdScreenshotOutput.stderr).error.message).toBe(
      "screenshot output path must name a file within the current working directory",
    );
    expect(cwdPackageOutput.status).toBe(1);
    expect(JSON.parse(cwdPackageOutput.stderr).error.message).toBe(
      "package output path must name a file within the current working directory",
    );
    expect(duplicateProofOutput.status).toBe(1);
    expect(JSON.parse(duplicateProofOutput.stderr).error.message).toBe(
      "Unexpected extra argument: second",
    );
    expect(duplicatePackageOutput.status).toBe(1);
    expect(JSON.parse(duplicatePackageOutput.stderr).error.message).toBe(
      "Unexpected extra argument: out/two",
    );
  });

  it("timestamps screenshot output paths", () => {
    const result = runRokit(["--dry-run", "screenshot", "artifacts/lab/story.jpg"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.path).not.toBe(resolve(repoRoot, "artifacts/lab/story.jpg"));
    expect(parsed.data.path).toContain(`${resolve(repoRoot, "artifacts/lab")}/`);
    expect(parsed.data.path).toMatch(/story-\d{8}-\d{6}-\d{3}\.jpg$/);
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
