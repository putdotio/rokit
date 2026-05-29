import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEffectCliEffect } from "../src/cli-command.js";
import { describeCli } from "../src/cli-describe.js";
import { parseInputJsonEffect } from "../src/cli-input-json.js";
import { runCommandEffect } from "../src/cli-runner.js";
import type { Command, CommandResult } from "../src/cli-types.js";
import { buildDebugCommand } from "../src/debug.js";

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

const runRokit = (args: readonly string[]) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: childCliEnv(),
  });

const childCliEnv = (): NodeJS.ProcessEnv => {
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

  return env;
};

const runCommand = async (command: Command, dryRun: boolean): Promise<CommandResult> =>
  await Effect.runPromise(
    runCommandEffect(undefined, command, dryRun).pipe(Effect.provide(NodeServices.layer)),
  );

const runDryCommand = async (command: Command): Promise<CommandResult> =>
  await runCommand(command, true);

const parseJsonCommand = async (value: string): Promise<Command> =>
  await Effect.runPromise(parseInputJsonEffect(value));

const parseCliCommand = async (args: readonly string[]): Promise<Command> => {
  const parsed = await Effect.runPromise(parseEffectCliEffect(args));
  if (parsed.command === undefined) {
    throw new Error("expected command");
  }

  return parsed.command;
};

const runJsonDryCommand = async (value: string): Promise<CommandResult> =>
  await runDryCommand(await parseJsonCommand(value));

describe("rokit CLI functionality", () => {
  it("boots the packaged binary", () => {
    const result = runRokit(["--version"]);
    const shortResult = runRokit(["-v"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^rokit v\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
    expect(shortResult.status).toBe(0);
    expect(shortResult.stdout.trim()).toBe(result.stdout.trim());
    expect(shortResult.stderr).toBe("");
  });

  it("prints advertised shell completions", () => {
    const result = runRokit(["--completions", "bash"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rokit");
    expect(result.stderr).toBe("");
  });

  it("describes the public automation surface", () => {
    const description = describeCli();

    if (description === undefined) {
      throw new Error("expected rokit description");
    }

    expect(description.schemaVersion).toBe(5);
    expect(description.automation).toMatchObject({
      dryRun: true,
      inputJson: true,
      nonTtyJsonDefault: true,
      outputFields: true,
      schemaIntrospection: true,
    });
    expect(description.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          required: expect.arrayContaining(["command", "appId"]),
        }),
        name: "launch",
      }),
    );
    expect(description.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          required: expect.arrayContaining(["command", "keys"]),
        }),
        name: "press",
      }),
    );
    expect(description.commands).toContainEqual(
      expect.objectContaining({
        inputJson: expect.objectContaining({
          required: expect.arrayContaining(["command", "outputDir"]),
        }),
        name: "proof",
      }),
    );
  });

  it("returns dry-run data for device commands without requiring a target", async () => {
    const [launch, press, discover] = await Promise.all([
      runDryCommand({
        args: {
          appId: "dev",
          params: new Map([
            ["source", "synthetic"],
            ["token", "abc=="],
          ]),
        },
        name: "launch",
      }),
      runDryCommand({
        args: {
          delayMs: 0,
          keys: ["Down"],
          maxAttempts: 2,
          until: {
            expectation: { state: "visible" },
            nodeName: "videoPlayerScreen",
          },
        },
        name: "press",
      }),
      runDryCommand({ name: "discover", timeoutMs: 250 }),
    ]);

    expect(launch).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { source: "synthetic", token: "abc==" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(press).toMatchObject({
      command: "press",
      data: {
        delayMs: 0,
        keys: ["Down"],
        maxAttempts: 2,
        until: {
          expectation: { state: "visible" },
          nodeName: "videoPlayerScreen",
        },
      },
      dryRun: true,
      status: "ok",
    });
    expect(discover).toMatchObject({
      command: "discover",
      data: { timeoutMs: 250 },
      dryRun: true,
      status: "ok",
    });
  });

  it("returns dry-run data for artifact and debug commands", async () => {
    const [pack, proof, consoleResult, screenshot, debugCommand] = await Promise.all([
      runDryCommand({ name: "package", outputPath: "out/channel" }),
      runDryCommand({ name: "proof", outputDir: "artifacts/proof", screenshot: true }),
      runDryCommand({
        args: { durationMs: 250, outputPath: "artifacts/debug/console.log" },
        name: "console",
      }),
      runDryCommand({ name: "screenshot", outputPath: "artifacts/lab/story.jpg" }),
      runDryCommand({
        args: {
          command: buildDebugCommand("help", []),
          durationMs: 250,
          idleTimeoutMs: 50,
        },
        name: "debug-command",
      }),
    ]);

    expect(pack).toMatchObject({
      command: "package",
      data: { path: resolve(repoRoot, "out/channel.zip") },
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
    expect(consoleResult).toMatchObject({
      command: "console",
      data: { durationMs: 250, port: 8085 },
      dryRun: true,
      status: "ok",
    });
    expect(debugCommand).toMatchObject({
      command: "debug-command",
      data: {
        command: "help",
        port: 8085,
      },
      dryRun: true,
      status: "ok",
    });

    expect(screenshot).toMatchObject({
      data: {
        path: expect.stringContaining(`${resolve(repoRoot, "artifacts/lab")}/story-`),
      },
    });
    expect(screenshot).toMatchObject({
      data: {
        path: expect.stringMatching(/story-\d{8}-\d{6}-\d{3}\.jpg$/),
      },
    });
  });

  it("keeps the legacy package --out contract", async () => {
    await expect(parseCliCommand(["package", "--out", "out/channel"])).resolves.toEqual({
      name: "package",
      outputPath: "out/channel",
    });
    await expect(parseCliCommand(["package", "out/channel"])).resolves.toEqual({
      name: "package",
      outputPath: "out/channel",
    });
    await expect(parseCliCommand(["package", "out/channel", "--out", "out/other"])).rejects.toThrow(
      "usage: rokit package <zip-path> or rokit package --out <zip-path>",
    );
  });

  it("validates dry-run command data before reporting success", async () => {
    await expect(runDryCommand({ name: "package", outputPath: "source/channel" })).rejects.toThrow(
      `package output path must be outside packaged roots: ${resolve(repoRoot, "source/channel.zip")}`,
    );
    await expect(runDryCommand({ name: "package", outputPath: "." })).rejects.toThrow(
      "package output path must name a file within the current working directory",
    );
    await expect(
      runDryCommand({ name: "screenshot", outputPath: "../outside.png" }),
    ).rejects.toThrow("screenshot output path must stay within the current working directory");
    await expect(
      runDryCommand({
        args: { delayMs: 0, keys: ["Bogus"], maxAttempts: 1 },
        name: "press",
      }),
    ).rejects.toThrow("unsupported remote key: Bogus");
  });

  it("parses JSON command payloads used by automation callers", async () => {
    const [launch, press, proof, pack] = await Promise.all([
      runJsonDryCommand(
        JSON.stringify({
          appId: "dev",
          command: "launch",
          params: { story: "app-dialog-empty", token: "abc==" },
        }),
      ),
      runJsonDryCommand(
        JSON.stringify({
          command: "press",
          keys: ["Down"],
          until: {
            expectation: { state: "visible" },
            nodeName: "videoPlayerScreen",
          },
        }),
      ),
      runJsonDryCommand(
        JSON.stringify({ command: "proof", outputDir: "artifacts/proof", screenshot: true }),
      ),
      runJsonDryCommand(JSON.stringify({ command: "package", outputPath: "out/channel" })),
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
    expect(press).toMatchObject({
      command: "press",
      data: {
        keys: ["Down"],
        maxAttempts: 8,
      },
      dryRun: true,
      status: "ok",
    });
    expect(proof).toMatchObject({
      command: "proof",
      data: { outputDir: resolve(repoRoot, "artifacts/proof"), screenshot: true },
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

  it("rejects invalid JSON command payloads", async () => {
    await expect(parseJsonCommand("{")).rejects.toThrow("input JSON must be valid JSON");
    await expect(
      parseJsonCommand(JSON.stringify({ command: "discover", timeoutMs: 0 })),
    ).rejects.toThrow("input JSON field must be a positive integer: timeoutMs");
    await expect(parseJsonCommand(JSON.stringify({ command: "press", keys: [] }))).rejects.toThrow(
      "input JSON field must include at least one key: keys",
    );
    await expect(
      parseJsonCommand(JSON.stringify({ command: "query", path: "/query/active-app?x=1" })),
    ).rejects.toThrow("ECP path must not include query strings or fragments");
  });

  it("runs describe through the command runner", async () => {
    const proof = await runCommand({ commandName: "proof", name: "describe" }, false);

    expect(proof).toMatchObject({
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
    expect(proof).toMatchObject({
      data: {
        commands: [expect.objectContaining({ name: "proof" })],
      },
    });
    await expect(runCommand({ commandName: "nope", name: "describe" }, false)).rejects.toThrow(
      "Unknown described command: nope",
    );
  });

  it("does not run target-required commands without a context", async () => {
    await expect(runCommand({ name: "check" }, false)).rejects.toThrow("ROKIT_TARGET is not set");
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
