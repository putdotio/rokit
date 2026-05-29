import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";

const nodeFileOutputLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const textEncoder = new TextEncoder();

export const writeTextFileEffect = Effect.fn("writeTextFile")(function* (
  path: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
  yield* fs.writeFile(path, textEncoder.encode(contents));

  return path;
});

export const writeTextFile = async (path: string, contents: string): Promise<string> =>
  await Effect.runPromise(Effect.provide(writeTextFileEffect(path, contents), nodeFileOutputLayer));
