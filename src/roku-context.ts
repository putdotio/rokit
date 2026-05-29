export type RokuContext = {
  readonly debugConsolePort?: number;
  readonly debugServerPort?: number;
  readonly password?: string;
  readonly target: string;
  readonly timeoutMs: number;
  readonly username: string;
};
