import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

type PackageConfig = {
  files: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPackageConfig = (): PackageConfig => {
  const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"));

  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error("package.json is missing files");
  }

  return {
    files: parsed.files.filter((value): value is string => typeof value === "string"),
  };
};

describe("package config", () => {
  it("packages the generic live probe with agent-facing docs", () => {
    const packageConfig = readPackageConfig();

    expect(packageConfig.files).toEqual(
      expect.arrayContaining(["AGENTS.md", "docs", "examples", "README.md", "SECURITY.md"]),
    );
  });
});
