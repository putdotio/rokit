import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { queryActiveAppEffect } from "./app-control.js";
import { checkDeviceEffect, getDeviceInfoEffect, type DeviceSummary } from "./device.js";
import { normalizeError } from "./errors.js";
import { queryMediaPlayerEffect } from "./media-player-query.js";
import type { MediaPlayerInfo } from "./media-player.js";
import { observeRokitEffect, type Observation } from "./observation.js";
import { timestampOutputPath } from "./output-path.js";
import { requirePasswordEffect } from "./roku-context-requirements.js";
import type { RokuContext } from "./roku-context.js";
import { querySceneGraphEffect } from "./scenegraph-query.js";
import { captureScreenshotEffect } from "./screenshot.js";
import {
  readSceneGraphFailure,
  readSceneGraphStatus,
  type SceneGraphStatus,
} from "./scenegraph.js";
import type { ActiveApp } from "./xml.js";

export type { Observation } from "./observation.js";

export type SnapshotSceneGraph = {
  readonly failure?: string;
  readonly status: SceneGraphStatus;
};

export type RokitSnapshot = {
  readonly activeApp: Observation<ActiveApp>;
  readonly device: Observation<DeviceSummary>;
  readonly mediaPlayer: Observation<MediaPlayerInfo>;
  readonly sceneGraph: Observation<SnapshotSceneGraph>;
};

export type ProofArtifact = {
  readonly kind: "json" | "screenshot" | "xml";
  readonly path: string;
};

export type ProofBundle = {
  readonly artifacts: readonly ProofArtifact[];
  readonly outputDir: string;
  readonly snapshot: RokitSnapshot;
};

const nodeProofLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const textEncoder = new TextEncoder();

export const collectSnapshotEffect = Effect.fn("collectSnapshot")(function* (context: RokuContext) {
  const sceneGraphXml = yield* observeRokitEffect(querySceneGraphEffect(context));

  return {
    activeApp: yield* observeRokitEffect(queryActiveAppEffect(context)),
    device: yield* observeRokitEffect(checkDeviceEffect(context)),
    mediaPlayer: yield* observeRokitEffect(queryMediaPlayerEffect(context)),
    sceneGraph:
      sceneGraphXml.status === "ok"
        ? {
            data: {
              failure: readSceneGraphFailure(sceneGraphXml.data),
              status: readSceneGraphStatus(sceneGraphXml.data),
            },
            status: "ok" as const,
          }
        : sceneGraphXml,
  };
});

export const writeProofEffect = Effect.fn("writeProof")(function* (
  context: RokuContext,
  outputDir: string,
  includeScreenshot: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const artifacts: ProofArtifact[] = [];

  yield* fs.makeDirectory(outputDir, { recursive: true });

  const writeJson = Effect.fn("writeProofJson")(function* (name: string, value: unknown) {
    const outputPath = path.join(outputDir, `${name}.json`);
    yield* fs.writeFile(outputPath, textEncoder.encode(`${JSON.stringify(value, null, 2)}\n`));
    artifacts.push({ kind: "json", path: outputPath });
    return outputPath;
  });

  const snapshot = yield* collectSnapshotEffect(context);
  yield* writeJson("summary", snapshot);

  const sceneGraph = yield* observeRokitEffect(querySceneGraphEffect(context));
  if (sceneGraph.status === "ok") {
    const outputPath = path.join(outputDir, "sgnodes.xml");
    yield* fs.writeFile(outputPath, textEncoder.encode(sceneGraph.data));
    artifacts.push({ kind: "xml", path: outputPath });
  }

  yield* writeJson("device-info", yield* observeRokitEffect(getDeviceInfoEffect(context)));
  yield* writeJson("active-app", yield* observeRokitEffect(queryActiveAppEffect(context)));
  yield* writeJson("media-player", yield* observeRokitEffect(queryMediaPlayerEffect(context)));

  if (includeScreenshot) {
    const password = yield* requirePasswordEffect(context);
    const screenshotPath = yield* captureScreenshotEffect(
      { ...context, password },
      timestampOutputPath(path.join(outputDir, "screenshot.png")),
    ).pipe(Effect.mapError(normalizeError));
    artifacts.push({ kind: "screenshot", path: screenshotPath });
  }

  return { artifacts, outputDir, snapshot };
});

export const collectSnapshot = async (context: RokuContext): Promise<RokitSnapshot> =>
  await Effect.runPromise(collectSnapshotEffect(context));

export const observe = async <T>(read: () => Promise<T>): Promise<Observation<T>> =>
  await Effect.runPromise(
    Effect.tryPromise({ catch: normalizeError, try: read }).pipe(observeRokitEffect),
  );

export const writeProof = async (
  context: RokuContext,
  outputDir: string,
  includeScreenshot: boolean,
): Promise<ProofBundle> =>
  await Effect.runPromise(
    Effect.provide(writeProofEffect(context, outputDir, includeScreenshot), nodeProofLayer),
  );

export const partialObservationMetadata = (snapshot: RokitSnapshot) => {
  const failedObservations = failedSnapshotObservations(snapshot);

  return failedObservations.length === 0
    ? {}
    : {
        failedObservations,
        partial: true as const,
      };
};

const failedSnapshotObservations = (snapshot: RokitSnapshot): readonly string[] => {
  const failures: string[] = [];

  if (snapshot.activeApp.status === "failed") {
    failures.push("activeApp");
  }

  if (snapshot.device.status === "failed") {
    failures.push("device");
  }

  if (snapshot.mediaPlayer.status === "failed") {
    failures.push("mediaPlayer");
  }

  if (snapshot.sceneGraph.status === "failed") {
    failures.push("sceneGraph");
  }

  return failures;
};
