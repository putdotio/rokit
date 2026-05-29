import { Effect, Option } from "effect";
import { optionToUndefined } from "./cli-argument.js";
import type { NodeCondition } from "./cli-types.js";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";
import { makeNodeCondition, type NodeConditionState } from "./node-condition.js";

export type NodeConditionCliInput = {
  readonly commandName: string;
  readonly condition: NodeConditionState;
  readonly nodeName: string;
  readonly value: Option.Option<string>;
};

export type OptionalNodeConditionCliInput = {
  readonly commandName: string;
  readonly nodeName: Option.Option<string>;
  readonly state: Option.Option<NodeConditionState>;
  readonly timeoutMs: Option.Option<number>;
  readonly value: Option.Option<string>;
};

export const nodeConditionFromCliInputEffect: (
  input: NodeConditionCliInput,
) => Effect.Effect<NodeCondition, RokitError> = Effect.fn("nodeConditionFromCliInput")(function* ({
  commandName,
  condition,
  nodeName,
  value,
}) {
  return yield* makeNodeConditionEffect(commandName, nodeName, condition, optionToUndefined(value));
});

export const optionalNodeConditionFromCliInputEffect: (
  input: OptionalNodeConditionCliInput,
) => Effect.Effect<NodeCondition | undefined, RokitError> = Effect.fn(
  "optionalNodeConditionFromCliInput",
)(function* ({ commandName, nodeName, state, timeoutMs, value }) {
  const parsedNodeName = optionToUndefined(nodeName);
  const parsedState = optionToUndefined(state);
  const parsedValue = optionToUndefined(value);
  const parsedTimeoutMs = optionToUndefined(timeoutMs);

  if (parsedNodeName === undefined) {
    if (parsedState !== undefined || parsedValue !== undefined || parsedTimeoutMs !== undefined) {
      return yield* Effect.fail(
        InvalidInput.make({ message: `usage: rokit ${commandName} <node-name>` }),
      );
    }

    return undefined;
  }

  return yield* makeNodeConditionEffect(
    commandName,
    parsedNodeName,
    parsedState ?? "visible",
    parsedValue,
  ).pipe(
    Effect.map((condition) => ({
      ...condition,
      timeoutMs: parsedTimeoutMs,
    })),
  );
});

const makeNodeConditionEffect = (
  commandName: string,
  nodeName: string,
  condition: NodeConditionState,
  value: string | undefined,
): Effect.Effect<NodeCondition, RokitError> =>
  Effect.try({
    try: () => makeNodeCondition(commandName, nodeName, condition, value),
    catch: normalizeError,
  });
