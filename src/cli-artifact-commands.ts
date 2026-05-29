import { Effect } from "effect";
import { Argument, Command as EffectCommand, Flag } from "effect/unstable/cli";
import {
  fileArgumentField,
  optionToUndefined,
  pathArgumentField,
  stringArgumentField,
} from "./cli-argument.js";
import { commandDescription, commandParameter } from "./cli-command-metadata.js";
import type { CommandCapture } from "./cli-command-shared.js";
import { strictCommand, withCommandDescription } from "./cli-command-shared.js";
import { InvalidInput } from "./errors.js";

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
    outputPath: stringArgumentField(commandParameter("package", "zip-path")).pipe(
      Argument.optional,
    ),
    out: Flag.string("out").pipe(
      Flag.withMetavar("zip-path"),
      Flag.withDescription(commandParameter("package", "zip-path").description),
      Flag.optional,
      Flag.withHidden,
    ),
  }).pipe(
    withCommandDescription(commandDescription("package")),
    EffectCommand.withHandler(({ out, outputPath }) =>
      packageOutputPath(optionToUndefined(outputPath), optionToUndefined(out)).pipe(
        Effect.flatMap((selectedOutputPath) =>
          capture({ name: "package", outputPath: selectedOutputPath }),
        ),
      ),
    ),
  ),
  strictCommand("install", {
    zipPath: fileArgumentField(commandParameter("install", "zip-path"), { mustExist: false }),
  }).pipe(
    withCommandDescription(commandDescription("install")),
    EffectCommand.withHandler(({ zipPath }) => capture({ name: "install", zipPath })),
  ),
];

const packageUsage = "usage: rokit package <zip-path> or rokit package --out <zip-path>";

const packageOutputPath = (
  positional: string | undefined,
  out: string | undefined,
): Effect.Effect<string, InvalidInput> => {
  if (positional !== undefined && out !== undefined) {
    return Effect.fail(InvalidInput.make({ message: packageUsage }));
  }

  const outputPath = positional ?? out;
  return outputPath === undefined
    ? Effect.fail(InvalidInput.make({ message: packageUsage }))
    : Effect.succeed(outputPath);
};
