import { Schema } from "effect";

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()("InvalidInput", {
  message: Schema.String,
}) {}

export class MissingTarget extends Schema.TaggedErrorClass<MissingTarget>()("MissingTarget", {}) {
  override get message(): string {
    return "ROKIT_TARGET is not set";
  }
}

export class MissingPassword extends Schema.TaggedErrorClass<MissingPassword>()(
  "MissingPassword",
  {},
) {
  override get message(): string {
    return "ROKIT_PASSWORD is not set";
  }
}

export class UnexpectedRokitFailure extends Schema.TaggedErrorClass<UnexpectedRokitFailure>()(
  "UnexpectedRokitFailure",
  {
    message: Schema.String,
  },
) {}

export type RokitError = InvalidInput | MissingPassword | MissingTarget | UnexpectedRokitFailure;

export const renderError = (error: RokitError): string => error.message;

export const normalizeError = (error: unknown): RokitError => {
  if (isRokitError(error)) {
    return error;
  }

  return UnexpectedRokitFailure.make({
    message: error instanceof Error ? error.message : String(error),
  });
};

const isRokitError = (error: unknown): error is RokitError =>
  error instanceof InvalidInput ||
  error instanceof MissingPassword ||
  error instanceof MissingTarget ||
  error instanceof UnexpectedRokitFailure;
