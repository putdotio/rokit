import { Effect } from "effect";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";

export const syncRokit = <A>(trySync: () => A): Effect.Effect<A, RokitError> =>
  Effect.try({ catch: normalizeError, try: trySync });

export const failRokit = (message: string): Effect.Effect<never, InvalidInput> =>
  Effect.fail(new InvalidInput({ message }));
