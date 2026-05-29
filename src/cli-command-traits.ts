import { commandMetadataFor, commandNames } from "./cli-command-metadata.js";
import type { Command, CommandName } from "./cli-types.js";

export { commandNames };

export const commandMutates = (name: CommandName): boolean => commandMetadataFor(name).mutates;

export const commandRequiresTarget = (name: CommandName): boolean =>
  commandMetadataFor(name).requiresTarget;

export const commandSupportsDryRun = (command: Command): boolean =>
  commandMetadataFor(command.name).dryRun;

export const commandNeedsTarget = (command: Command, dryRun: boolean): boolean =>
  commandRequiresTarget(command.name) && !(dryRun && commandSupportsDryRun(command));
