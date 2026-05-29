import { Command as EffectCommand, Flag } from "effect/unstable/cli";
import { fileArgumentField, pathArgumentField } from "./cli-argument.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";

export const artifactCommands = (capture: CommandCapture) => [
  strictCommand("screenshot", {
    outputPath: pathArgumentField(commandParameter("screenshot", "output-path")),
  }).pipe(
    withCommandDescription(commandDescription("screenshot")),
    EffectCommand.withHandler(({ outputPath }) => capture({ name: "screenshot", outputPath })),
  ),
  strictCommand("proof", {
    outputDir: pathArgumentField(commandParameter("proof", "output-dir")),
    screenshot: Flag.boolean("screenshot").pipe(
      Flag.withDescription(commandParameter("proof", "screenshot").description),
    ),
  }).pipe(
    withCommandDescription(commandDescription("proof")),
    EffectCommand.withHandler(({ outputDir, screenshot }) =>
      capture({
        name: "proof",
        outputDir,
        screenshot,
      }),
    ),
  ),
  strictCommand("package", {
    outputPath: pathArgumentField(commandParameter("package", "zip-path")),
  }).pipe(
    withCommandDescription(commandDescription("package")),
    EffectCommand.withHandler(({ outputPath }) => capture({ name: "package", outputPath })),
  ),
  strictCommand("install", {
    zipPath: fileArgumentField(commandParameter("install", "zip-path"), { mustExist: false }),
  }).pipe(
    withCommandDescription(commandDescription("install")),
    EffectCommand.withHandler(({ zipPath }) => capture({ name: "install", zipPath })),
  ),
];
