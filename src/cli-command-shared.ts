import { Effect } from "effect";
import { Argument, Command as EffectCommand } from "effect/unstable/cli";
import type { Command } from "./cli-types.js";
import type { RokitGlobalFlagContext } from "./cli-options.js";

export type CommandCapture = (
  command?: Command,
) => Effect.Effect<void, never, RokitGlobalFlagContext>;

export const strictCommand = <
  const Name extends string,
  const Config extends EffectCommand.Command.Config,
>(
  name: Name,
  config: Config,
) =>
  EffectCommand.make(name, {
    ...config,
    // Effect CLI leaves surplus positional arguments unconsumed by default.
    // Keep command definitions idiomatic while making rokit reject typos.
    extra: Argument.string("extra").pipe(
      Argument.variadic(),
      Argument.filter(
        (extra) => extra.length === 0,
        (extra) => `Unexpected extra argument: ${extra.join(" ")}`,
      ),
    ),
  });

export const withCommandDescription =
  (description: string) =>
  <Name extends string, Input, ContextInput, E, R>(
    command: EffectCommand.Command<Name, Input, ContextInput, E, R>,
  ): EffectCommand.Command<Name, Input, ContextInput, E, R> =>
    command.pipe(
      EffectCommand.withDescription(description),
      EffectCommand.withShortDescription(description),
    );
