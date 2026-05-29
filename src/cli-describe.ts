import { describedCommands, globalOptions, schemaVersion } from "./cli-command-metadata.js";
import type { CliDescription } from "./cli-types.js";

export const describeCli = (commandName?: string): CliDescription | undefined => {
  const commands =
    commandName === undefined
      ? describedCommands
      : describedCommands.filter((command) => command.name === commandName);

  if (commands.length === 0) {
    return undefined;
  }

  return {
    automation: {
      dryRun: true,
      inputJson: true,
      nonTtyJsonDefault: true,
      outputFields: true,
      schemaIntrospection: true,
    },
    commands,
    globalOptions,
    schemaVersion,
  };
};

export const isDescribedCommandName = (commandName: string): boolean =>
  describedCommands.some((command) => command.name === commandName);
