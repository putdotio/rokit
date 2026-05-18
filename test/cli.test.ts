import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cliPath = resolve("dist/rokit.mjs");
const prepareEffectPath = resolve("scripts/prepare-effect.sh");

const runRokit = (args: string[]) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });

const runRokitWithEnv = (args: string[], env: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("rokit cli", () => {
  it("prints help without a device target", () => {
    const result = runRokit(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rokit - Roku device harness helper");
    expect(result.stdout).toContain("rokit check");
    expect(result.stdout).toContain("rokit media-player");
    expect(result.stdout).toContain("rokit wait-node");
    expect(result.stdout).toContain("--output json | text");
    expect(result.stderr).toBe("");
  });

  it("prints the package version", () => {
    const result = runRokit(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
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
    expect(parsed.data.schemaVersion).toBe(2);
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
        inputJson: expect.objectContaining({
          required: expect.arrayContaining(["command", "outputDir"]),
        }),
        name: "proof",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "outputDir", required: true, type: "path" }),
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
          expect.objectContaining({ name: "condition", type: "visible|hidden|absent|text|attr" }),
        ]),
      }),
    );
    expect(parsed.data.globalOptions).toContainEqual(
      expect.objectContaining({ name: "fields", type: "field-mask" }),
    );
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
    const result = runRokit(["--dry-run", "launch", "dev", "--param", "source=synthetic"]);
    const packageResult = runRokit(["--dry-run", "package", "--out", "out/channel"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "launch",
      data: {
        appId: "dev",
        params: { source: "synthetic" },
      },
      dryRun: true,
      status: "ok",
    });
    expect(packageResult.status).toBe(0);
    expect(JSON.parse(packageResult.stdout)).toMatchObject({
      command: "package",
      data: { path: resolve("out/channel.zip") },
      dryRun: true,
      status: "ok",
    });
  });

  it("validates dry-run command payloads like live command payloads", () => {
    const cappedPress = runRokit([
      "--dry-run",
      "press",
      "--max",
      "2",
      "Down",
      "--until-node",
      "videoPlayerScreen",
      "visible",
    ]);
    const invalidPress = runRokit(["--dry-run", "press", "Bogus"]);

    expect(cappedPress.status).toBe(0);
    expect(JSON.parse(cappedPress.stdout)).toMatchObject({
      command: "press",
      data: { maxAttempts: 2 },
      dryRun: true,
      status: "ok",
    });

    expect(invalidPress.status).toBe(1);
    expect(JSON.parse(invalidPress.stderr)).toEqual({
      error: { message: "unsupported remote key: Bogus" },
      status: "failed",
    });
  });

  it("accepts typed JSON payloads", () => {
    const result = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ command: "press", delayMs: 25, keys: ["Down", "Select"] }),
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "press",
      data: {
        delayMs: 25,
        keys: ["Down", "Select"],
      },
      dryRun: true,
    });
  });

  it("rejects mixed input-json and positional command arguments", () => {
    const result = runRokit([
      "--dry-run",
      "--input-json",
      JSON.stringify({ appId: "dev", command: "launch" }),
      "press",
      "Bogus",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "usage: rokit --input-json '<payload>'" },
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

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      data: { appId: "dev" },
      status: "ok",
    });
    expect(missingField.status).toBe(0);
    expect(JSON.parse(missingField.stdout)).toEqual({
      data: {},
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
    const cwdPackageOutput = runRokit(["--dry-run", "package", "--out", "."]);
    const duplicateProofOutput = runRokit(["--dry-run", "proof", "first", "second"]);

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
      "usage: rokit proof <output-dir> [--screenshot]",
    );
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
      error: { message: "usage: rokit [--json|--output json|--output text] <command>" },
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
