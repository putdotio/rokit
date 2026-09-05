import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { readResponseBytesEffect } from "../src/response-body.js";

describe("bounded response bodies", () => {
  it("cancels a stream as soon as its byte budget is exceeded", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(3));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(Effect.runPromise(readResponseBytesEffect(response, String, 5))).rejects.toThrow(
      "maximum byte length",
    );
    expect(cancelled).toBe(true);
  });

  it("accepts a body exactly at its budget", async () => {
    const body = new Uint8Array([1, 2, 3]);
    await expect(
      Effect.runPromise(readResponseBytesEffect(new Response(body), String, body.length)),
    ).resolves.toEqual(body);
  });
});
