import type { RokuDebugCommand } from "./debug.js";
import type { RokuContext } from "./roku-context.js";
import type { NodeExpectation } from "./scenegraph.js";

export type LaunchArgs = {
  readonly appId: string;
  readonly params: ReadonlyMap<string, string>;
};

export type NodeCondition = {
  readonly expectation: NodeExpectation;
  readonly nodeName: string;
  readonly timeoutMs?: number;
};

export type PressArgs = {
  readonly delayMs: number;
  readonly keys: readonly string[];
  readonly maxAttempts: number;
  readonly until?: NodeCondition;
};

export type ConsoleArgs = {
  readonly durationMs: number;
  readonly outputPath: string;
};

export type DebugCommandArgs = {
  readonly command: RokuDebugCommand;
  readonly durationMs: number;
  readonly idleTimeoutMs: number;
};

export type OutputMode = "json" | "text";

export type CliOptions = {
  readonly dryRun: boolean;
  readonly fields: readonly string[];
  readonly inputJson?: string;
  readonly outputMode: OutputMode;
};

export type CommandResult = {
  readonly command: string;
  readonly data?: unknown;
  readonly dryRun?: true;
  readonly failedObservations?: readonly string[];
  readonly message?: string;
  readonly partial?: true;
  readonly status: "ok";
};

export type DescribedField = {
  readonly description: string;
  readonly name: string;
  readonly required: boolean;
  readonly repeatable?: boolean;
  readonly type: string;
  readonly values?: readonly string[];
};

export type DescribedCommand = {
  readonly description: string;
  readonly inputJson: {
    readonly fields: readonly DescribedField[];
    readonly required: readonly string[];
  };
  readonly mutates: boolean;
  readonly name: CommandName;
  readonly parameters: readonly DescribedField[];
  readonly requiresTarget: boolean;
};

export type CliDescription = {
  readonly automation: {
    readonly dryRun: boolean;
    readonly inputJson: boolean;
    readonly nonTtyJsonDefault: boolean;
    readonly outputFields: boolean;
    readonly schemaIntrospection: boolean;
  };
  readonly commands: readonly DescribedCommand[];
  readonly globalOptions: readonly DescribedField[];
  readonly schemaVersion: number;
};

export type Command =
  | { readonly commandName?: string; readonly name: "describe" }
  | { readonly name: "active-app" }
  | { readonly args: NodeCondition; readonly name: "assert-node" }
  | { readonly name: "check" }
  | { readonly args: ConsoleArgs; readonly name: "console" }
  | { readonly args: DebugCommandArgs; readonly name: "debug-command" }
  | { readonly name: "device-info" }
  | { readonly name: "discover"; readonly timeoutMs?: number }
  | { readonly name: "install"; readonly zipPath: string }
  | { readonly name: "launch"; readonly args: LaunchArgs }
  | { readonly name: "media-player" }
  | { readonly name: "package"; readonly outputPath: string }
  | { readonly name: "proof"; readonly outputDir: string; readonly screenshot: boolean }
  | { readonly args: PressArgs; readonly name: "press" }
  | { readonly name: "query"; readonly path: string }
  | { readonly name: "screenshot"; readonly outputPath: string }
  | { readonly name: "sgnodes" }
  | { readonly name: "snapshot" }
  | { readonly appId: string; readonly name: "wait-active"; readonly timeoutMs?: number }
  | { readonly name: "wait-media-player"; readonly state: string; readonly timeoutMs?: number }
  | { readonly args: NodeCondition; readonly name: "wait-node" }
  | {
      readonly appId: string;
      readonly mediaState?: string;
      readonly name: "wait-ready";
      readonly node?: NodeCondition;
      readonly timeoutMs?: number;
    };

export type CommandName = Command["name"];

export type ParsedCli = CliOptions & {
  readonly command?: Command;
};

export type DeviceCommandContext = RokuContext | undefined;
