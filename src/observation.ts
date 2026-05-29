import { Effect } from "effect";
import { renderError, type RokitError } from "./errors.js";

export type Observation<T> =
  | { readonly data: T; readonly status: "ok" }
  | { readonly error: { readonly message: string }; readonly status: "failed" };

export const observeRokitEffect = <T>(
  read: Effect.Effect<T, RokitError>,
): Effect.Effect<Observation<T>, never> =>
  Effect.match(read, {
    onFailure: (error): Observation<T> => ({
      error: { message: renderError(error) },
      status: "failed",
    }),
    onSuccess: (data): Observation<T> => ({ data, status: "ok" }),
  });
