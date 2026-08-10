import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { validateEcpPath } from "./ecp.js";
import { InvalidInput, MissingPassword, MissingTarget } from "./errors.js";

export const appDir = process.cwd();
export const rokitDir = join(appDir, ".rokit");
export const envPath = join(rokitDir, ".env");

export type RokitEnv = {
  readonly password?: string;
  readonly target?: string;
  readonly timeoutMs: number;
  readonly username: string;
};

export const loadLocalEnv = () => {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
};

export const loadEnv = (): RokitEnv => ({
  password: process.env.ROKIT_PASSWORD ?? process.env.ROKU_DEV_PASSWORD,
  target: process.env.ROKIT_TARGET ?? process.env.ROKU_DEV_TARGET,
  timeoutMs: parseTimeout(process.env.ROKIT_TIMEOUT_MS),
  username: process.env.ROKIT_USERNAME ?? "rokudev",
});

export const requireTarget = (env: RokitEnv): string => {
  const target = env.target?.trim();

  if (!target) {
    throw new MissingTarget({});
  }

  return normalizeTarget(target);
};

export const requirePassword = (env: RokitEnv): string => {
  const password = env.password;

  if (!password) {
    throw new MissingPassword({});
  }

  return password;
};

export const resolveOutputPath = (path: string, label: string): string => {
  rejectUnsafeInput(path, label);

  const resolved = resolve(appDir, path);
  const relativePath = relative(appDir, resolved);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail(`${label} must stay within the current working directory`);
  }

  return resolved;
};

export const resolveFileOutputPath = (path: string, label: string): string => {
  const resolved = resolveOutputPath(path, label);

  if (resolved === appDir) {
    fail(`${label} must name a file within the current working directory`);
  }

  return resolved;
};

export const rejectUnsafeInput = (value: string, label: string): void => {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    fail(`${label} contains control characters`);
  }
};

export const rejectUnsafeEcpPath = (value: string): void => {
  try {
    validateEcpPath(value);
  } catch (error) {
    fail(formatErrorMessage(error));
  }
};

export const fail = (message: string): never => {
  throw new InvalidInput({ message });
};

export const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const normalizeTarget = (target: string) =>
  target
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const parseTimeout = (value: string | undefined): number => {
  if (value === undefined) {
    return 10_000;
  }

  const timeout = Number(value);

  if (!Number.isFinite(timeout) || timeout <= 0) {
    fail(`Invalid ROKIT_TIMEOUT_MS: ${value}`);
  }

  return timeout;
};
