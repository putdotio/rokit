import { Effect, FileSystem, Stdio, Stream } from "effect";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";

export const resolveInputJsonSource: (
  source: string,
) => Effect.Effect<string, RokitError, FileSystem.FileSystem | Stdio.Stdio> = Effect.fn(
  "resolveInputJsonSource",
)(function* (source) {
  if (source === "-") {
    return yield* readStdinText();
  }

  if (source.startsWith("@")) {
    const path = source.slice(1);

    if (path.length === 0) {
      return yield* Effect.fail(
        new InvalidInput({ message: "--input-json @file requires a file path" }),
      );
    }

    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(path).pipe(Effect.mapError(normalizeError));
  }

  return source;
});

const readStdinText: () => Effect.Effect<string, RokitError, Stdio.Stdio> = Effect.fn(
  "readInputJsonStdin",
)(function* () {
  const stdio = yield* Stdio.Stdio;
  const chunks = yield* stdio.stdin.pipe(
    Stream.decodeText(),
    Stream.runCollect,
    Effect.mapError(normalizeError),
  );

  return chunks.join("");
});
