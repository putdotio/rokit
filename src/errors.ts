import { Schema } from "effect";

export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", {
  message: Schema.String,
}) {}

export class MissingTarget extends Schema.TaggedError<MissingTarget>()("MissingTarget", {}) {
  override get message(): string {
    return "ROKIT_TARGET is not set";
  }
}

export class MissingPassword extends Schema.TaggedError<MissingPassword>()("MissingPassword", {}) {
  override get message(): string {
    return "ROKIT_PASSWORD is not set";
  }
}

export class DebugPortUnavailable extends Schema.TaggedError<DebugPortUnavailable>()(
  "DebugPortUnavailable",
  {
    detail: Schema.String,
    port: Schema.Number,
  },
) {
  override get message(): string {
    return `Roku debug port ${this.port} unavailable: ${this.detail}`;
  }
}

export class UnexpectedRokitFailure extends Schema.TaggedError<UnexpectedRokitFailure>()(
  "UnexpectedRokitFailure",
  {
    message: Schema.String,
  },
) {}

export type RokitError =
  | DebugPortUnavailable
  | InvalidInput
  | MissingPassword
  | MissingTarget
  | UnexpectedRokitFailure;

export const renderError = (error: RokitError): string => error.message;

export const normalizeError = (error: unknown): RokitError => {
  if (isRokitError(error)) {
    return error;
  }

  return new UnexpectedRokitFailure({
    message: error instanceof Error ? error.message : String(error),
  });
};

const isRokitError = (error: unknown): error is RokitError =>
  error instanceof DebugPortUnavailable ||
  error instanceof InvalidInput ||
  error instanceof MissingPassword ||
  error instanceof MissingTarget ||
  error instanceof UnexpectedRokitFailure;
