import type { CommandResult } from "./cli-types.js";
import type { MediaPlayerInfo } from "./media-player.js";
import { partialObservationMetadata, type ProofBundle, type RokitSnapshot } from "./proof.js";

export const observationResult = (command: string, data: RokitSnapshot): CommandResult => ({
  command,
  data,
  ...partialObservationMetadata(data),
  status: "ok",
});

export const proofBundleResult = (command: string, data: ProofBundle): CommandResult => ({
  command,
  data,
  ...partialObservationMetadata(data.snapshot),
  message: data.artifacts.map((artifact) => `${artifact.kind}: ${artifact.path}`).join("\n"),
  status: "ok",
});

export const formatMediaPlayerMessage = (mediaPlayer: MediaPlayerInfo): string => {
  const parts = [
    `state=${mediaPlayer.state ?? "unknown"}`,
    `container=${mediaPlayer.container ?? "unknown"}`,
    `position=${formatMaybeMs(mediaPlayer.positionMs)}`,
    `duration=${formatMaybeMs(mediaPlayer.durationMs)}`,
  ];

  return `media-player: ${parts.join(" ")}`;
};

const formatMaybeMs = (value: number | undefined): string =>
  value === undefined ? "unknown" : `${value}ms`;
