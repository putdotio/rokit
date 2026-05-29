import { Effect } from "effect";
import { MissingPassword, MissingTarget } from "./errors.js";
import type { RokuContext } from "./roku-context.js";

export const requireRokuContextEffect = (
  context: RokuContext | undefined,
): Effect.Effect<RokuContext, MissingTarget> =>
  context === undefined ? Effect.fail(MissingTarget.make({})) : Effect.succeed(context);

export const requirePasswordEffect = (
  context: RokuContext,
): Effect.Effect<string, MissingPassword> =>
  context.password === undefined || context.password === ""
    ? Effect.fail(MissingPassword.make({}))
    : Effect.succeed(context.password);
