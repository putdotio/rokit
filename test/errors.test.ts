import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { InvalidInput, MissingTarget, normalizeError, renderError } from "../src/errors.js";

describe("rokit errors", () => {
  it.effect("renders schema-backed CLI errors", () =>
    Effect.sync(() => {
      assert.strictEqual(renderError(InvalidInput.make({ message: "bad command" })), "bad command");
      assert.strictEqual(renderError(MissingTarget.make({})), "ROKIT_TARGET is not set");
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
