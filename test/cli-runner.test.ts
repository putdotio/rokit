import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommandEffect } from "../src/cli-runner.js";
import type { Command } from "../src/cli-types.js";
import type { RokuContext } from "../src/roku.js";

const context: RokuContext = {
  target: "192.0.2.1",
  timeoutMs: 1_000,
  username: "rokudev",
};

describe("CLI runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for a press until condition when until-timeout-ms is set", async () => {
    let sceneGraphCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);

      if (url === "http://192.0.2.1:8060/keypress/Down") {
        return new Response("");
      }

      if (url === "http://192.0.2.1:8060/query/sgnodes/all") {
        sceneGraphCalls += 1;
        return new Response(sceneGraphCalls === 1 ? missingNodeXml : readyNodeXml);
      }

      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const command: Command = {
      args: {
        delayMs: 0,
        keys: ["Down"],
        maxAttempts: 1,
        until: {
          expectation: { state: "visible" },
          nodeName: "readyNode",
          timeoutMs: 700,
        },
      },
      name: "press",
    };

    await expect(
      Effect.runPromise(
        runCommandEffect(context, command, false).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).resolves.toMatchObject({
      command: "press",
      data: { attempts: 1, keys: ["Down"] },
      status: "ok",
    });
    expect(sceneGraphCalls).toBe(2);
  });
});

const missingNodeXml = "<sgnodes><All_Nodes><App /></All_Nodes><status>OK</status></sgnodes>";
const readyNodeXml =
  '<sgnodes><All_Nodes><App /><Label name="readyNode" /></All_Nodes><status>OK</status></sgnodes>';
