import { Clock, Effect } from "effect";

export type AttemptResult<A, E> =
  | { readonly error: E; readonly status: "failed" }
  | { readonly status: "ok"; readonly value: A };

export type PollDecision<A, S> =
  | { readonly state: S; readonly status: "pending" }
  | { readonly status: "done"; readonly value: A };

export type PollOptions<A, E, S, R> = {
  readonly intervalMs: number;
  readonly initialState: S;
  readonly poll: (state: S) => Effect.Effect<PollDecision<A, S>, E, R>;
  readonly timeout: (state: S) => Effect.Effect<never, E, R>;
  readonly timeoutMs: number;
};

export const attemptEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<AttemptResult<A, E>, never, R> =>
  Effect.match(effect, {
    onFailure: (error): AttemptResult<A, E> => ({ error, status: "failed" }),
    onSuccess: (value): AttemptResult<A, E> => ({ status: "ok", value }),
  });

export const pollDone = <A>(value: A): PollDecision<A, never> => ({ status: "done", value });

export const pollPending = <S>(state: S): PollDecision<never, S> => ({
  state,
  status: "pending",
});

export const pollUntilEffect = Effect.fn("pollUntil")(function* <A, E, S, R>(
  options: PollOptions<A, E, S, R>,
): Effect.fn.Return<A, E, R> {
  const start = yield* Clock.currentTimeMillis;
  let state = options.initialState;

  while (true) {
    const decision = yield* options.poll(state);
    if (decision.status === "done") {
      return decision.value;
    }

    state = decision.state;
    const now = yield* Clock.currentTimeMillis;
    if (now - start >= options.timeoutMs) {
      return yield* options.timeout(state);
    }

    yield* Effect.sleep(options.intervalMs);
  }
});
