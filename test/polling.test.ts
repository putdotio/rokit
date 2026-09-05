import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vite-plus/test";
import { pollDone, pollPending, pollUntilEffect } from "../src/polling.js";

const timeout = (state: string) => Effect.fail(`timeout: ${state}`);

describe("polling deadlines", () => {
  it.effect("accepts an observation completed within the budget", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        pollUntilEffect({
          initialState: "initial",
          intervalMs: 500,
          timeoutMs: 20,
          timeout,
          poll: () => Effect.sleep(10).pipe(Effect.as(pollDone("ready"))),
        }),
      );
      yield* TestClock.adjust(10);
      expect(yield* Fiber.join(fiber)).toBe("ready");
    }),
  );

  it.effect.each(["success", "failure"] as const)(
    "interrupts a slow %s at the deadline",
    (outcome) =>
      Effect.gen(function* () {
        let interrupted = false;
        const observation = Effect.sleep(80).pipe(
          Effect.flatMap(() =>
            outcome === "success"
              ? Effect.succeed(pollDone("ready"))
              : Effect.fail("late transport error"),
          ),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        );
        const fiber = yield* Effect.forkChild(
          pollUntilEffect({
            initialState: "initial",
            intervalMs: 500,
            timeoutMs: 20,
            timeout,
            poll: () => observation,
          }).pipe(Effect.flip),
        );
        yield* TestClock.adjust(20);
        expect(interrupted).toBe(true);
        expect(yield* Fiber.join(fiber)).toBe("timeout: initial");
      }),
  );

  it.effect("expires during a long polling interval without another observation", () =>
    Effect.gen(function* () {
      let calls = 0;
      const fiber = yield* Effect.forkChild(
        pollUntilEffect({
          initialState: "initial",
          intervalMs: 500,
          timeoutMs: 20,
          timeout,
          poll: () =>
            Effect.sync(() => {
              calls += 1;
              return pollPending("last observation");
            }),
        }).pipe(Effect.flip),
      );
      yield* TestClock.adjust(20);
      expect(yield* Fiber.join(fiber)).toBe("timeout: last observation");
      expect(calls).toBe(1);
    }),
  );

  it.effect.each([0, -1])("makes no observation with budget %s", (timeoutMs) =>
    Effect.gen(function* () {
      let calls = 0;
      const result = yield* pollUntilEffect({
        initialState: "initial",
        intervalMs: 500,
        timeoutMs,
        timeout,
        poll: () =>
          Effect.sync(() => {
            calls += 1;
            return pollDone("ready");
          }),
      }).pipe(Effect.flip);
      expect(result).toBe("timeout: initial");
      expect(calls).toBe(0);
    }),
  );

  it.effect("retains the last completed observation when the next observation stalls", () =>
    Effect.gen(function* () {
      let calls = 0;
      let interrupted = false;
      const fiber = yield* Effect.forkChild(
        pollUntilEffect({
          initialState: "initial",
          intervalMs: 5,
          timeoutMs: 20,
          timeout,
          poll: () =>
            Effect.suspend(() => {
              calls += 1;
              return calls === 1
                ? Effect.succeed(pollPending("known state"))
                : Effect.never.pipe(
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        interrupted = true;
                      }),
                    ),
                  );
            }),
        }).pipe(Effect.flip),
      );
      yield* TestClock.adjust(20);
      expect(yield* Fiber.join(fiber)).toBe("timeout: known state");
      expect(calls).toBe(2);
      expect(interrupted).toBe(true);
    }),
  );
});
