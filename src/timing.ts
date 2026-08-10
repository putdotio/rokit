import { Effect } from "effect";

export const abortSignalWithTimeout = (signal: AbortSignal, timeoutMs: number): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

export const sleepEffect = Effect.fn("sleep")(function* (ms: number) {
  yield* Effect.sleep(ms);
});

export const sleep = async (ms: number): Promise<void> => {
  await Effect.runPromise(sleepEffect(ms));
};
