import { Effect } from "effect";
import { queryEcpEffect } from "./app-control.js";
import { ecpUrl, fetchEcpUrlTextEffect } from "./ecp.js";
import { normalizeError } from "./errors.js";
import { attemptEffect, pollDone, pollPending, pollUntilEffect } from "./polling.js";
import { failRokit, syncRokit } from "./rokit-effect.js";
import type { RokuContext } from "./roku-context.js";
import { assertNamedNode, isCompleteSceneGraph, type NodeExpectation } from "./scenegraph.js";
import { sleepEffect } from "./timing.js";

export type SceneGraphSource = "sgnodes" | "app-ui";

export type RetryOptions = {
  readonly attempts?: number;
  readonly requireAppNode?: boolean;
  readonly requireComplete?: boolean;
  readonly retryDelayMs?: number;
  readonly source?: SceneGraphSource;
};

export type SceneGraphAssertion = (xml: string) => void;

export type WaitForSceneGraphAssertionOptions = {
  readonly pollIntervalMs?: number;
  readonly source?: SceneGraphSource;
  readonly timeoutMs?: number;
};

type SceneGraphPollState = {
  readonly lastError?: string;
};

const defaultPollIntervalMs = 500;

// Roku OS 11 can freeze and reboot when /query/sgnodes/all dumps the tree while the app
// builds a screen. app-ui and single-node queries skip that dump.
const sceneGraphPaths: Record<SceneGraphSource, string> = {
  "app-ui": "/query/app-ui",
  sgnodes: "/query/sgnodes/all",
};

export const querySceneGraphEffect = Effect.fn("querySceneGraph")(function* (
  context: RokuContext,
  options: RetryOptions = {},
) {
  const attempts = options.attempts ?? 1;
  const requireAppNode = options.requireAppNode ?? false;
  const requireComplete = options.requireComplete ?? false;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const path = sceneGraphPaths[options.source ?? "sgnodes"];
  let lastXml = "";
  let lastError: string | undefined;
  let lastMissingAppNode = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = yield* attemptEffect(queryEcpEffect(context, path));

    if (result.status === "ok") {
      const xml = result.value;
      const complete = !requireComplete || isCompleteSceneGraph(xml);
      const hasTree = xml.includes("<All_Nodes>") || xml.includes("<app-ui>");
      const hasAppNode = !requireAppNode || !hasTree || xml.includes("<App ");

      if (complete && hasAppNode) {
        return xml;
      }

      lastXml = xml;
      lastMissingAppNode = complete && !hasAppNode;
    } else {
      lastError = result.error.message;
      lastXml = "";
      lastMissingAppNode = false;
    }

    if (attempt < attempts - 1) {
      yield* sleepEffect(retryDelayMs);
    }
  }

  if (lastXml !== "") {
    if (lastMissingAppNode) {
      return yield* failRokit("SceneGraph query returned complete XML without an App node");
    }

    return yield* failRokit("SceneGraph query returned incomplete XML");
  }

  return yield* failRokit(`SceneGraph query failed: ${lastError ?? "unknown error"}`);
});

export const querySceneGraph = async (
  context: RokuContext,
  options: RetryOptions = {},
): Promise<string> => await Effect.runPromise(querySceneGraphEffect(context, options));

export const querySceneGraphNodeEffect = Effect.fn("querySceneGraphNode")(function* (
  context: RokuContext,
  nodeName: string,
) {
  const url = ecpUrl(context, "/query/sgnodes/nodes");
  url.searchParams.set("node-id", nodeName);

  const xml = yield* fetchEcpUrlTextEffect(context, url, "/query/sgnodes/nodes").pipe(
    Effect.mapError(normalizeError),
  );

  if (!isCompleteSceneGraph(xml)) {
    return yield* failRokit(`SceneGraph node query for "${nodeName}" returned incomplete XML`);
  }

  return xml;
});

export const querySceneGraphNode = async (
  context: RokuContext,
  nodeName: string,
): Promise<string> => await Effect.runPromise(querySceneGraphNodeEffect(context, nodeName));

export const assertSceneGraphNodeEffect = Effect.fn("assertSceneGraphNode")(function* (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
) {
  const xml = yield* querySceneGraphNodeEffect(context, nodeName);
  yield* syncRokit(() => {
    assertNamedNode(xml, nodeName, expectation);
  });
});

export const assertSceneGraphNode = async (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
): Promise<void> =>
  await Effect.runPromise(assertSceneGraphNodeEffect(context, nodeName, expectation));

export const waitForSceneGraphNodeEffect = Effect.fn("waitForSceneGraphNode")(function* (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
  timeoutMs = 30_000,
) {
  const initialState: SceneGraphPollState = {};

  return yield* pollUntilEffect({
    initialState,
    intervalMs: defaultPollIntervalMs,
    poll: (state) =>
      attemptEffect(assertSceneGraphNodeEffect(context, nodeName, expectation)).pipe(
        Effect.map((assertion) =>
          assertion.status === "ok"
            ? pollDone(undefined)
            : pollPending({ ...state, lastError: assertion.error.message }),
        ),
      ),
    timeout: (state) => {
      const suffix = state.lastError ? `; last observation: ${state.lastError}` : "";

      return failRokit(`expected SceneGraph node "${nodeName}" to match condition${suffix}`);
    },
    timeoutMs,
  });
});

export const waitForSceneGraphNode = async (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
  timeoutMs = 30_000,
): Promise<void> =>
  await Effect.runPromise(waitForSceneGraphNodeEffect(context, nodeName, expectation, timeoutMs));

export const waitForSceneGraphAssertionEffect = Effect.fn("waitForSceneGraphAssertion")(function* (
  context: RokuContext,
  description: string,
  assertXml: SceneGraphAssertion,
  options: WaitForSceneGraphAssertionOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const initialState: SceneGraphPollState = {};

  return yield* pollUntilEffect({
    initialState,
    intervalMs: pollIntervalMs,
    poll: (state) =>
      attemptEffect(
        querySceneGraphEffect(context, { source: options.source }).pipe(
          Effect.tap((xml) =>
            syncRokit(() => {
              assertXml(xml);
            }),
          ),
        ),
      ).pipe(
        Effect.map((result) =>
          result.status === "ok"
            ? pollDone(result.value)
            : pollPending({ ...state, lastError: result.error.message }),
        ),
      ),
    timeout: (state) => {
      const suffix = state.lastError ? `; last observation: ${state.lastError}` : "";

      return failRokit(`${description}${suffix}`);
    },
    timeoutMs,
  });
});

export const waitForSceneGraphAssertion = async (
  context: RokuContext,
  description: string,
  assertXml: SceneGraphAssertion,
  options: WaitForSceneGraphAssertionOptions = {},
): Promise<string> =>
  await Effect.runPromise(
    waitForSceneGraphAssertionEffect(context, description, assertXml, options),
  );
