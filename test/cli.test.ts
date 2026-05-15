import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cliPath = resolve("dist/rokit.mjs");

const runRokit = (args: string[]) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });

describe("rokit cli", () => {
  it("prints help without a device target", () => {
    const result = runRokit(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rokit - Roku device harness helper");
    expect(result.stdout).toContain("rokit check");
    expect(result.stderr).toBe("");
  });

  it("prints the package version", () => {
    const result = runRokit(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
  });

  it("reports missing target without a stack trace", () => {
    const result = runRokit(["check"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ROKIT_TARGET is not set");
    expect(result.stderr).not.toContain("Error:");
  });
});
