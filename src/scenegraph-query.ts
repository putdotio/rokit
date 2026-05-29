import { Effect } from "effect";
import { queryEcpEffect } from "./app-control.js";
import { attemptEffect, pollDone, pollPending, pollUntilEffect } from "./polling.js";
import { failRokit, syncRokit } from "./rokit-effect.js";
import type { RokuContext } from "./roku-context.js";
import { assertNamedNode, isCompleteSceneGraph, type NodeExpectation } from "./scenegraph.js";
import { sleepEffect } from "./timing.js";

export type RetryOptions = {
  readonly attempts?: number;
  readonly requireAppNode?: boolean;
  readonly requireComplete?: boolean;
  readonly retryDelayMs?: number;
};

export type SceneGraphAssertion = (xml: string) => void;

export type WaitForSceneGraphAssertionOptions = {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
};

type SceneGraphPollState = {
  readonly lastError?: string;
};

const defaultPollIntervalMs = 500;

export const querySceneGraphEffect = Effect.fn("querySceneGraph")(function* (
  context: RokuContext,
  options: RetryOptions = {},
) {
  const attempts = options.attempts ?? 1;
  const requireAppNode = options.requireAppNode ?? false;
  const requireComplete = options.requireComplete ?? false;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let lastXml = "";
  let lastError: string | undefined;
  let lastMissingAppNode = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = yield* attemptEffect(queryEcpEffect(context, "/query/sgnodes/all"));
    if (result.status === "ok") {
      const xml = result.value;
      const complete = !requireComplete || isCompleteSceneGraph(xml);
      const hasAppNode = !requireAppNode || !xml.includes("<All_Nodes>") || xml.includes("<App ");
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

export const assertSceneGraphNodeEffect = Effect.fn("assertSceneGraphNode")(function* (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
) {
  const xml = yield* querySceneGraphEffect(context);
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
        querySceneGraphEffect(context).pipe(
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
