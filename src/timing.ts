import { Effect } from "effect";

export const sleepEffect = Effect.fn("sleep")(function* (ms: number) {
  yield* Effect.sleep(ms);
});

export const sleep = async (ms: number): Promise<void> => {
  await Effect.runPromise(sleepEffect(ms));
};
