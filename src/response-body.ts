import { Effect } from "effect";

export const readResponseBytesEffect = <E>(
  response: Response,
  onError: (error: unknown) => E,
): Effect.Effect<Uint8Array, E> =>
  Effect.tryPromise({
    try: (signal) => readResponseBytes(response, signal),
    catch: onError,
  });

export const readResponseTextEffect = <E>(
  response: Response,
  onError: (error: unknown) => E,
): Effect.Effect<string, E> =>
  Effect.tryPromise({
    try: async (signal) => new TextDecoder().decode(await readResponseBytes(response, signal)),
    catch: onError,
  });

const readResponseBytes = async (response: Response, signal: AbortSignal): Promise<Uint8Array> => {
  if (response.body === null) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  await response.body.pipeTo(
    new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(chunk);
      },
    }),
    { signal },
  );

  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
};
