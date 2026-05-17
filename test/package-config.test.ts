import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageConfig = {
  devDependencies: {
    "@types/node": string;
  };
  engines: {
    node: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPackageConfig = (): PackageConfig => {
  const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"));

  if (!isRecord(parsed) || !isRecord(parsed.devDependencies) || !isRecord(parsed.engines)) {
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
  };
};

describe("package config", () => {
  it("keeps Node ambient types within the supported engine major", () => {
    const packageConfig = readPackageConfig();
    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");

    expect(packageConfig.engines.node).toContain(">=24.");
    expect(packageConfig.engines.node).toContain("<25");
    expect(packageConfig.devDependencies["@types/node"]).toMatch(/^\^24\./);
    expect(lockfile).toContain("@types/node@24.");
    expect(lockfile).not.toContain("@types/node@25.");
  });
});
