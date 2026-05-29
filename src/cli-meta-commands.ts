import { Argument, Command as EffectCommand } from "effect/unstable/cli";
import { optionToUndefined, stringArgumentField } from "./cli-argument.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";

export const metaCommands = (capture: CommandCapture) => [
  strictCommand("describe", {
    commandName: stringArgumentField(commandParameter("describe", "command")).pipe(
      Argument.optional,
    ),
  }).pipe(
    withCommandDescription(commandDescription("describe")),
    EffectCommand.withHandler(({ commandName }) =>
      capture({ commandName: optionToUndefined(commandName), name: "describe" }),
    ),
  ),
];
