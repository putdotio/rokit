import { readXmlAttribute, readXmlTag } from "./xml.js";

export type MediaPlayerState =
  | "buffer"
  | "close"
  | "error"
  | "none"
  | "open"
  | "pause"
  | "play"
  | "stop"
  | string;

export type MediaPlayerInfo = {
  readonly audio?: string;
  readonly buffering?: {
    readonly current?: number;
    readonly max?: number;
    readonly target?: number;
  };
  readonly captions?: string;
  readonly container?: string;
  readonly durationMs?: number;
  readonly error: boolean;
  readonly isLive?: boolean;
  readonly positionMs?: number;
  readonly state?: MediaPlayerState;
  readonly video?: string;
  readonly videoResolution?: string;
};

export const readMediaPlayerInfo = (xml: string): MediaPlayerInfo => {
  const playerAttributes = /<player(?:\s+([^>]*))?>/.exec(xml)?.[1] ?? "";
  const formatAttributes = /<format(?:\s+([^>]*))?\/>/.exec(xml)?.[1] ?? "";
  const bufferingAttributes = /<buffering(?:\s+([^>]*))?\/>/.exec(xml)?.[1];

  return {
    audio: readXmlAttribute(formatAttributes, "audio"),
    buffering:
      bufferingAttributes === undefined
        ? undefined
        : {
            current: readXmlNumberAttribute(bufferingAttributes, "current"),
            max: readXmlNumberAttribute(bufferingAttributes, "max"),
            target: readXmlNumberAttribute(bufferingAttributes, "target"),
          },
    captions: readXmlAttribute(formatAttributes, "captions"),
    container: readXmlAttribute(formatAttributes, "container"),
    durationMs: readXmlNumberTag(xml, "duration"),
    error: readXmlAttribute(playerAttributes, "error") === "true",
    isLive: readXmlBooleanTag(xml, "is_live"),
    positionMs: readXmlNumberTag(xml, "position"),
    state: readXmlAttribute(playerAttributes, "state"),
    video: readXmlAttribute(formatAttributes, "video"),
    videoResolution: readXmlAttribute(formatAttributes, "video_res"),
  };
};

export const readMediaPlayerState = (xml: string): MediaPlayerState | undefined =>
  readMediaPlayerInfo(xml).state;

export const readMediaPlayerPositionMs = (xml: string): number | undefined =>
  readMediaPlayerInfo(xml).positionMs;

export const readMediaPlayerContainer = (xml: string): string | undefined =>
  readMediaPlayerInfo(xml).container;

export const isActiveMediaPlayerState = (state: string | undefined): boolean =>
  state === "buffer" || state === "buffering" || state === "pause" || state === "play";

const readXmlNumberTag = (xml: string, tag: string): number | undefined => {
  const rawValue = readXmlTag(xml, tag);
  if (rawValue === undefined) {
    return undefined;
  }

  const match = /-?\d+(?:\.\d+)?/.exec(rawValue);
  if (!match) {
    return undefined;
  }

  return Number(match[0]);
};

const readXmlBooleanTag = (xml: string, tag: string): boolean | undefined => {
  const value = readXmlTag(xml, tag);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return undefined;
};

const readXmlNumberAttribute = (attributes: string, name: string): number | undefined => {
  const value = readXmlAttribute(attributes, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
