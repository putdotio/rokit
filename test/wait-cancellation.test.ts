import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { waitForActiveAppEffect } from "../src/app-control.js";

const context = { target: "192.0.2.1", timeoutMs: 1000, username: "rokudev" };

describe("public wait cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("aborts a stalled request at the wait budget rather than the request timeout", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    await expect(Effect.runPromise(waitForActiveAppEffect(context, "dev", 20))).rejects.toThrow(
      "expected active app dev",
    );
    expect(signal?.aborted).toBe(true);
  });

  it("cancels a stalled response body at the wait budget", async () => {
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull: () => new Promise<void>(() => {}),
              cancel: () => {
                cancelled = true;
              },
            }),
          ),
      ),
    );
    await expect(Effect.runPromise(waitForActiveAppEffect(context, "dev", 20))).rejects.toThrow(
      "expected active app dev",
    );
    expect(cancelled).toBe(true);
  });
});
