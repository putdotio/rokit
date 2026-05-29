import type { CommandName, DescribedCommand, DescribedField } from "./cli-types.js";
import { nodeConditionStates } from "./node-condition.js";

type CommandTraits = {
  readonly dryRun: boolean;
  readonly mutates: boolean;
  readonly requiresTarget: boolean;
};

type CommandMetadata = CommandTraits & {
  readonly description: string;
  readonly inputJsonFields: readonly DescribedField[];
  readonly name: CommandName;
  readonly parameters: readonly DescribedField[];
};

const nodeConditionType = nodeConditionStates.join("|");

export const commandMetadata: readonly CommandMetadata[] = [
  command(
    "describe",
    { dryRun: false, mutates: false, requiresTarget: false },
    "Print machine-readable command schemas.",
    [
      argumentField(
        "command",
        "string",
        "Optional command name to return as a one-command schema.",
        false,
      ),
    ],
    [
      optionField(
        "commandName",
        "string",
        "Optional command name to return as a one-command schema.",
      ),
    ],
  ),
  command(
    "check",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Check ECP and developer installer reachability.",
    [],
  ),
  command(
    "console",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Capture BrightScript console output from port 8085.",
    [
      argumentField("output-path", "path", "Console log output path inside the current app root."),
      optionField("duration-ms", "positive-integer", "Capture duration in milliseconds."),
    ],
    [
      argumentField("outputPath", "path", "Console log output path inside the current app root."),
      optionField("durationMs", "positive-integer", "Capture duration in milliseconds."),
    ],
  ),
  command(
    "debug-command",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Run an allowlisted Roku debug command.",
    [
      argumentField("command", "string", "Allowlisted Roku debug command."),
      argumentField("args", "string[]", "Debug command arguments.", false, true),
      optionField("duration-ms", "positive-integer", "Maximum read duration in milliseconds."),
      optionField(
        "idle-timeout-ms",
        "positive-integer",
        "Stop reading after this many idle milliseconds.",
      ),
    ],
    [
      argumentField("debugCommand", "string", "Allowlisted Roku debug command."),
      argumentField("args", "string[]", "Debug command arguments.", false, true),
      optionField("durationMs", "positive-integer", "Maximum read duration in milliseconds."),
      optionField(
        "idleTimeoutMs",
        "positive-integer",
        "Stop reading after this many idle milliseconds.",
      ),
    ],
  ),
  command(
    "discover",
    { dryRun: true, mutates: false, requiresTarget: false },
    "Discover Roku ECP devices with SSDP.",
    [optionField("timeout-ms", "positive-integer", "Discovery timeout in milliseconds.")],
    [optionField("timeoutMs", "positive-integer", "Discovery timeout in milliseconds.")],
  ),
  command(
    "device-info",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read enhanced Roku device metadata.",
    [],
  ),
  command(
    "active-app",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read the foreground app.",
    [],
  ),
  command(
    "media-player",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read parsed /query/media-player state.",
    [],
  ),
  command(
    "snapshot",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read a compact state snapshot.",
    [],
  ),
  command(
    "proof",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Write reviewable state artifacts.",
    [
      argumentField("output-dir", "path", "Directory where proof artifacts are written."),
      optionField("screenshot", "boolean", "Include a developer screenshot."),
    ],
    [
      argumentField("outputDir", "path", "Directory where proof artifacts are written."),
      optionField("screenshot", "boolean", "Include a developer screenshot."),
    ],
  ),
  command(
    "package",
    { dryRun: true, mutates: true, requiresTarget: false },
    "Create a sideload ZIP from the current app root.",
    [argumentField("zip-path", "path", "ZIP output path inside the current app root.")],
    [argumentField("outputPath", "path", "ZIP output path inside the current app root.")],
  ),
  command(
    "install",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Publish an existing ZIP to a developer-enabled Roku.",
    [argumentField("zip-path", "path", "Existing sideload ZIP path.")],
    [argumentField("zipPath", "path", "Existing sideload ZIP path.")],
  ),
  command(
    "launch",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Launch an app by id with optional params.",
    [
      argumentField("app-id", "string", "Roku application id."),
      optionField("param", "key=value", "Launch parameter.", false, true),
    ],
    [
      argumentField("appId", "string", "Roku application id."),
      optionField("params", "record<string,string>", "Launch parameters."),
    ],
  ),
  command(
    "press",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Send remote keys, optionally until a node condition matches.",
    [
      argumentField("key", "string[]", "Remote key to send.", true, true),
      optionField("delay-ms", "non-negative-integer", "Delay between keys in milliseconds."),
      optionField("max", "positive-integer", "Maximum repeated attempts."),
      optionField("until-node", "string", "SceneGraph node that stops the loop."),
      optionField(
        "until-state",
        nodeConditionType,
        "Expected state for the until node.",
        false,
        false,
        nodeConditionStates,
      ),
      optionField("until-value", "string", "Text or attr name=value value for the until node."),
      optionField("until-timeout-ms", "positive-integer", "Timeout for the until node condition."),
    ],
    [
      argumentField("keys", "string[]", "Remote keys to send.", true, true),
      optionField("delayMs", "non-negative-integer", "Delay between keys in milliseconds."),
      optionField("maxAttempts", "positive-integer", "Maximum repeated attempts."),
      optionField("until", "node-condition", "SceneGraph condition that stops the loop."),
    ],
  ),
  command(
    "query",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read a raw ECP path.",
    [argumentField("ecp-path", "ecp-path", "Raw ECP path without query string or fragment.")],
    [argumentField("path", "ecp-path", "Raw ECP path without query string or fragment.")],
  ),
  command(
    "sgnodes",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Read raw SceneGraph XML.",
    [],
  ),
  command(
    "assert-node",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Assert one SceneGraph node condition.",
    nodeConditionFields(),
    nodeConditionInputJsonFields(),
  ),
  command(
    "wait-node",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Wait for a SceneGraph node condition.",
    [
      ...nodeConditionFields(),
      optionField("timeout-ms", "positive-integer", "Wait timeout in milliseconds."),
    ],
    [
      ...nodeConditionInputJsonFields(),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ],
  ),
  command(
    "wait-active",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Wait for a foreground app id.",
    [
      argumentField("app-id", "string", "Expected foreground Roku application id."),
      optionField("timeout-ms", "positive-integer", "Wait timeout in milliseconds."),
    ],
    [
      argumentField("appId", "string", "Expected foreground Roku application id."),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ],
  ),
  command(
    "wait-media-player",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Wait for a media-player state.",
    [
      argumentField("state", "string", "Expected media-player state."),
      optionField("timeout-ms", "positive-integer", "Wait timeout in milliseconds."),
    ],
    [
      argumentField("state", "string", "Expected media-player state."),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ],
  ),
  command(
    "wait-ready",
    { dryRun: false, mutates: false, requiresTarget: true },
    "Wait for active app plus optional node/media readiness.",
    [
      argumentField("app-id", "string", "Expected foreground Roku application id."),
      argumentField("node-name", "string", "Optional SceneGraph node to wait for.", false),
      argumentField(
        "condition",
        nodeConditionType,
        "Expected state for the optional node.",
        false,
        false,
        nodeConditionStates,
      ),
      argumentField(
        "value",
        "string",
        "Text or attr name=value pair for text/attr conditions.",
        false,
      ),
      optionField("media-state", "string", "Optional media-player state to wait for."),
      optionField("node-timeout-ms", "positive-integer", "Timeout for the optional node."),
      optionField("timeout-ms", "positive-integer", "Wait timeout in milliseconds."),
    ],
    [
      argumentField("appId", "string", "Expected foreground Roku application id."),
      optionField("mediaState", "string", "Optional media-player state to wait for."),
      optionField("node", "node-condition", "Optional SceneGraph node condition."),
      optionField("timeoutMs", "positive-integer", "Wait timeout in milliseconds."),
    ],
  ),
  command(
    "screenshot",
    { dryRun: true, mutates: true, requiresTarget: true },
    "Write a timestamped developer screenshot.",
    [
      argumentField(
        "output-path",
        "path",
        "Screenshot base output path inside the current app root.",
      ),
    ],
    [
      argumentField(
        "outputPath",
        "path",
        "Screenshot base output path inside the current app root.",
      ),
    ],
  ),
];

export const commandNames: readonly CommandName[] = commandMetadata.map((command) => command.name);

export const describedCommands: readonly DescribedCommand[] = commandMetadata.map((metadata) => ({
  description: metadata.description,
  inputJson: {
    fields: [
      {
        description: "Command name.",
        name: "command",
        required: true,
        type: "string",
        values: [metadata.name],
      },
      ...metadata.inputJsonFields,
    ],
    required: [
      "command",
      ...metadata.inputJsonFields.filter((field) => field.required).map((field) => field.name),
    ],
  },
  mutates: metadata.mutates,
  name: metadata.name,
  parameters: metadata.parameters,
  requiresTarget: metadata.requiresTarget,
}));

export const globalOptions: readonly DescribedField[] = [
  globalField("json", "boolean", "Print structured JSON output."),
  globalField("output", "json|text", "Select structured or human output.", false, ["json", "text"]),
  globalField("dry-run", "boolean", "Validate mutating commands without side effects."),
  globalField("fields", "field-mask", "Comma-separated JSON field mask for output trimming."),
  globalField(
    "input-json",
    "json-source",
    "Command payload as inline JSON, @file, or - for stdin.",
  ),
];

export const schemaVersion = 5;

export const commandDescription = (name: CommandName): string =>
  commandMetadataFor(name).description;

export const commandParameter = (commandName: CommandName, fieldName: string): DescribedField =>
  describedField(commandMetadataFor(commandName).parameters, fieldName, `${commandName} parameter`);

export const globalOption = (fieldName: string): DescribedField =>
  describedField(globalOptions, fieldName, "global option");

export const commandMetadataFor = (name: CommandName): CommandMetadata => {
  const metadata = commandMetadata.find((command) => command.name === name);

  if (metadata === undefined) {
    throw new Error(`Missing command metadata: ${name}`);
  }

  return metadata;
};

function describedField(
  fields: readonly DescribedField[],
  fieldName: string,
  label: string,
): DescribedField {
  const field = fields.find((candidate) => candidate.name === fieldName);

  if (field === undefined) {
    throw new Error(`Missing ${label}: ${fieldName}`);
  }

  return field;
}

function command(
  name: CommandName,
  traits: CommandTraits,
  description: string,
  parameters: readonly DescribedField[],
  inputJsonFields: readonly DescribedField[] = parameters,
): CommandMetadata {
  return {
    ...traits,
    description,
    inputJsonFields,
    name,
    parameters,
  };
}

function argumentField(
  name: string,
  type: string,
  description: string,
  required = true,
  repeatable = false,
  values?: readonly string[],
): DescribedField {
  return {
    description,
    name,
    repeatable,
    required,
    type,
    values,
  };
}

function optionField(
  name: string,
  type: string,
  description: string,
  required = false,
  repeatable = false,
  values?: readonly string[],
): DescribedField {
  return {
    description,
    name,
    repeatable,
    required,
    type,
    values,
  };
}

function globalField(
  name: string,
  type: string,
  description: string,
  required = false,
  values?: readonly string[],
): DescribedField {
  return {
    description,
    name,
    required,
    type,
    values,
  };
}

function nodeConditionFields(): readonly DescribedField[] {
  return [
    argumentField("node-name", "string", "SceneGraph node name."),
    argumentField(
      "condition",
      nodeConditionType,
      "Expected node condition.",
      true,
      false,
      nodeConditionStates,
    ),
    argumentField(
      "value",
      "string",
      "Text or attr name=value pair for text/attr conditions.",
      false,
    ),
  ];
}

function nodeConditionInputJsonFields(): readonly DescribedField[] {
  return [
    argumentField("nodeName", "string", "SceneGraph node name."),
    argumentField(
      "expectation",
      "node-expectation-object",
      "Expected node state, text, or attribute object.",
    ),
  ];
}
