import { Effect, Schema } from "effect";
import type { NodeCondition } from "./cli-types.js";
import { InvalidInput } from "./errors.js";
import { failRokit } from "./rokit-effect.js";
import type { NodeExpectation } from "./scenegraph.js";

const InputJsonRecord = Schema.Record(Schema.String, Schema.Unknown);
const NonEmptyString = Schema.NonEmptyString;
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const StringArray = Schema.Array(Schema.String);
const StringMap = Schema.Record(Schema.String, Schema.String);
const NodeState = Schema.Literals(["visible", "hidden", "absent"]);
const NodeExpectationSchema = Schema.Union([
  Schema.Struct({
    attribute: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    state: NodeState,
    text: Schema.optionalKey(Schema.String),
  }),
]);
const NodeConditionSchema = Schema.Struct({
  expectation: NodeExpectationSchema,
  nodeName: NonEmptyString,
  timeoutMs: Schema.optionalKey(PositiveInteger),
});

type InputJsonRecord = typeof InputJsonRecord.Type;
type NodeExpectationFromSchema = typeof NodeExpectationSchema.Type;
type NodeConditionFromSchema = typeof NodeConditionSchema.Type;

export const parseJsonRecordEffect: (
  value: string,
) => Effect.Effect<InputJsonRecord, InvalidInput> = Effect.fn("parseJsonRecord")(function* (value) {
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(value),
    catch: () => InvalidInput.make({ message: "input JSON must be valid JSON" }),
  });

  return yield* readRecordEffect(parsed, "input JSON must be an object");
});

export const readStringEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<string, InvalidInput> = Effect.fn("readInputJsonString")(
  function* (record, key) {
    const value = record[key];

    if (value === undefined) {
      return yield* failRokit(`input JSON is missing string field: ${key}`);
    }

    return yield* Schema.decodeUnknownEffect(NonEmptyString)(value).pipe(
      Effect.mapError(() =>
        InvalidInput.make({ message: `input JSON is missing string field: ${key}` }),
      ),
    );
  },
);

export const readOptionalStringEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<string | undefined, InvalidInput> = Effect.fn("readOptionalInputJsonString")(
  function* (record, key) {
    const value = record[key];

    if (value === undefined) {
      return undefined;
    }

    return yield* Schema.decodeUnknownEffect(Schema.String)(value).pipe(
      Effect.mapError(() =>
        InvalidInput.make({ message: `input JSON field must be a string: ${key}` }),
      ),
    );
  },
);

export const readOptionalBooleanEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<boolean | undefined, InvalidInput> = Effect.fn("readOptionalInputJsonBoolean")(
  function* (record, key) {
    const value = record[key];

    if (value === undefined) {
      return undefined;
    }

    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
      Effect.mapError(() =>
        InvalidInput.make({ message: `input JSON field must be a boolean: ${key}` }),
      ),
    );
  },
);

export const readOptionalNumberEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<number | undefined, InvalidInput> = Effect.fn("readOptionalInputJsonNumber")(
  function* (record, key) {
    const value = record[key];

    if (value === undefined) {
      return undefined;
    }

    return yield* Schema.decodeUnknownEffect(PositiveInteger)(value).pipe(
      Effect.mapError(() =>
        InvalidInput.make({ message: `input JSON field must be a positive integer: ${key}` }),
      ),
    );
  },
);

export const readOptionalNonNegativeNumberEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<number | undefined, InvalidInput> = Effect.fn(
  "readOptionalInputJsonNonNegativeNumber",
)(function* (record, key) {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  return yield* Schema.decodeUnknownEffect(NonNegativeInteger)(value).pipe(
    Effect.mapError(() =>
      InvalidInput.make({ message: `input JSON field must be a non-negative integer: ${key}` }),
    ),
  );
});

export const readStringArrayEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<readonly string[], InvalidInput> = Effect.fn("readInputJsonStringArray")(
  function* (record, key) {
    return yield* Schema.decodeUnknownEffect(StringArray)(record[key]).pipe(
      Effect.mapError(() =>
        InvalidInput.make({ message: `input JSON field must be a string array: ${key}` }),
      ),
    );
  },
);

export const readOptionalStringArrayEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<readonly string[] | undefined, InvalidInput> = Effect.fn(
  "readOptionalInputJsonStringArray",
)(function* (record, key) {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  return yield* Schema.decodeUnknownEffect(StringArray)(value).pipe(
    Effect.mapError(() =>
      InvalidInput.make({ message: `input JSON field must be a string array: ${key}` }),
    ),
  );
});

export const readStringMapEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<ReadonlyMap<string, string>, InvalidInput> = Effect.fn("readInputJsonStringMap")(
  function* (record, key) {
    const value = record[key];

    if (value === undefined) {
      return new Map();
    }

    const valueRecord = yield* readStringMapRecordEffect(value, key);
    return new Map(Object.entries(valueRecord));
  },
);

export const readOptionalNodeConditionEffect: (
  record: InputJsonRecord,
  key: string,
) => Effect.Effect<NodeCondition | undefined, InvalidInput> = Effect.fn(
  "readOptionalInputJsonNodeCondition",
)(function* (record, key) {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  return yield* readNodeConditionEffect(value, key);
});

export const readNodeExpectationEffect: (
  record: InputJsonRecord,
) => Effect.Effect<NodeExpectation, InvalidInput> = Effect.fn("readInputJsonNodeExpectation")(
  function* (record) {
    const expectation = record.expectation;
    const decoded = yield* Schema.decodeUnknownEffect(NodeExpectationSchema)(expectation).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed<NodeExpectationFromSchema | undefined>(undefined),
        onSuccess: (value) => Effect.succeed<NodeExpectationFromSchema | undefined>(value),
      }),
    );

    if (decoded !== undefined) {
      return decoded;
    }

    const expectationRecord = yield* readRecordOrUndefinedEffect(expectation);
    const state = expectationRecord?.state;
    const text = expectationRecord?.text;

    if ((state === "visible" || state === "hidden" || state === "absent") && text !== undefined) {
      yield* Schema.decodeUnknownEffect(Schema.String)(text).pipe(
        Effect.mapError(() =>
          InvalidInput.make({ message: "input JSON node expectation text must be a string" }),
        ),
      );
    }

    return yield* failRokit("input JSON is missing a valid node expectation");
  },
);

const readRecordEffect: (
  value: unknown,
  message: string,
) => Effect.Effect<InputJsonRecord, InvalidInput> = Effect.fn("readInputJsonRecord")(
  function* (value, message) {
    return yield* Schema.decodeUnknownEffect(InputJsonRecord)(value).pipe(
      Effect.mapError(() => InvalidInput.make({ message })),
    );
  },
);

const readRecordOrUndefinedEffect: (
  value: unknown,
) => Effect.Effect<InputJsonRecord | undefined, never> = Effect.fn(
  "readInputJsonRecordOrUndefined",
)(function* (value) {
  return yield* Schema.decodeUnknownEffect(InputJsonRecord)(value).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (record) => record,
    }),
  );
});

const readStringMapRecordEffect: (
  value: unknown,
  key: string,
) => Effect.Effect<Readonly<Record<string, string>>, InvalidInput> = Effect.fn(
  "readInputJsonStringMapRecord",
)(function* (value, key) {
  const decoded = yield* Schema.decodeUnknownEffect(StringMap)(value).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed<Readonly<Record<string, string>> | undefined>(undefined),
      onSuccess: (record) => Effect.succeed<Readonly<Record<string, string>> | undefined>(record),
    }),
  );

  if (decoded !== undefined) {
    return decoded;
  }

  const valueRecord = yield* readRecordEffect(value, `input JSON field must be an object: ${key}`);
  for (const mapValue of Object.values(valueRecord)) {
    if (typeof mapValue !== "string") {
      return yield* failRokit(`input JSON map values must be strings: ${key}`);
    }
  }

  return yield* failRokit(`input JSON field must be an object: ${key}`);
});

const readNodeConditionEffect: (
  value: unknown,
  key: string,
) => Effect.Effect<NodeCondition, InvalidInput> = Effect.fn("readInputJsonNodeCondition")(
  function* (value, key) {
    const decoded = yield* Schema.decodeUnknownEffect(NodeConditionSchema)(value).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed<NodeConditionFromSchema | undefined>(undefined),
        onSuccess: (condition) => Effect.succeed<NodeConditionFromSchema | undefined>(condition),
      }),
    );

    if (decoded !== undefined) {
      return decoded;
    }

    const record = yield* readRecordEffect(value, `input JSON field must be an object: ${key}`);
    return {
      expectation: yield* readNodeExpectationEffect(record),
      nodeName: yield* readStringEffect(record, "nodeName"),
      timeoutMs: yield* readOptionalNumberEffect(record, "timeoutMs"),
    };
  },
);
