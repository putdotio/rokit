import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageConfig = {
  devDependencies: {
    "@types/node": string;
  };
  engines: {
    node: string;
  };
  files: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPackageConfig = (): PackageConfig => {
  const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"));

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.devDependencies) ||
    !isRecord(parsed.engines) ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("package.json is missing devDependencies or engines");
  }

  const nodeTypes = parsed.devDependencies["@types/node"];
  const nodeEngine = parsed.engines.node;

  if (typeof nodeTypes !== "string" || typeof nodeEngine !== "string") {
    throw new Error("package.json is missing @types/node or engines.node");
  }

  return {
    devDependencies: {
      "@types/node": nodeTypes,
    },
    engines: {
      node: nodeEngine,
    },
    files: parsed.files.filter((value): value is string => typeof value === "string"),
  };
};

const readNodeTypesMajor = (specifier: string): string => {
  const match = /^\^(\d+)\./.exec(specifier);

  if (match?.[1] === undefined) {
    throw new Error("@types/node must use a caret major version specifier");
  }

  return match[1];
};

describe("package config", () => {
  it("keeps Node ambient types at or above the minimum supported engine major", () => {
    const packageConfig = readPackageConfig();
    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    const nodeTypesMajor = readNodeTypesMajor(packageConfig.devDependencies["@types/node"]);

    expect(packageConfig.engines.node).toContain(">=24.");
    expect(packageConfig.devDependencies["@types/node"]).toMatch(/^\^(2[5-9]|[3-9]\d)\./);
    expect(lockfile).toContain(`@types/node@${nodeTypesMajor}.`);
  });

  it("packages the generic live probe with agent-facing docs", () => {
    const packageConfig = readPackageConfig();

    expect(packageConfig.files).toEqual(
      expect.arrayContaining(["AGENTS.md", "docs", "examples", "README.md", "SECURITY.md"]),
    );
  });
});
