import { existsSync } from "node:fs";
import { join } from "node:path";

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
    return fail("ROKIT_TARGET is not set");
  }

  return normalizeTarget(target);
};

export const requirePassword = (env: RokitEnv): string => {
  const password = env.password;

  if (!password) {
    return fail("ROKIT_PASSWORD is not set");
  }

  return password;
};

export class RokitCliError extends Error {}

export const fail = (message: string): never => {
  throw new RokitCliError(message);
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
