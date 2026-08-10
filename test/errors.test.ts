import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  DebugPortUnavailable,
  InvalidInput,
  MissingTarget,
  normalizeError,
  renderError,
} from "../src/errors.js";

describe("rokit errors", () => {
  it.effect("renders schema-backed CLI errors", () =>
    Effect.sync(() => {
      assert.strictEqual(renderError(new InvalidInput({ message: "bad command" })), "bad command");
      assert.strictEqual(renderError(new MissingTarget({})), "ROKIT_TARGET is not set");
      assert.strictEqual(
        renderError(new DebugPortUnavailable({ detail: "connection refused", port: 8085 })),
        "Roku debug port 8085 unavailable: connection refused",
      );
    }),
  );

  it.effect("normalizes unknown thrown values at the Effect boundary", () =>
    Effect.sync(() => {
      const normalized = normalizeError(new Error("network failed"));

      assert.strictEqual(normalized._tag, "UnexpectedRokitFailure");
      assert.strictEqual(normalized.message, "network failed");
    }),
  );
});
