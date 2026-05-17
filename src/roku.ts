import * as rokuDeploy from "roku-deploy";
import { basename, dirname, extname, resolve } from "node:path";
import { assertNamedNode, type NodeExpectation } from "./scenegraph.js";
import { readActiveApp, readXmlAttribute, readXmlTag, type ActiveApp } from "./xml.js";

const ecpPort = 8060;

const remoteKeys = [
  "Home",
  "Rev",
  "Fwd",
  "Play",
  "Select",
  "Left",
  "Right",
  "Down",
  "Up",
  "Back",
  "InstantReplay",
  "Info",
  "Backspace",
  "Search",
  "Enter",
  "VolumeDown",
  "VolumeMute",
  "VolumeUp",
  "PowerOff",
  "ChannelUp",
  "ChannelDown",
  "InputTuner",
  "InputHDMI1",
  "InputHDMI2",
  "InputHDMI3",
  "InputHDMI4",
] as const;

const remoteKeySet: ReadonlySet<string> = new Set(remoteKeys);

export type RemoteKey = (typeof remoteKeys)[number] | `Lit_${string}`;

export type RokuContext = {
  readonly password?: string;
  readonly target: string;
  readonly timeoutMs: number;
  readonly username: string;
};

export type DeviceSummary = {
  readonly ecp: string;
  readonly installerStatus: number;
  readonly model: string;
  readonly name: string;
};

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

export type RetryOptions = {
  readonly attempts?: number;
  readonly retryDelayMs?: number;
};

export type SceneGraphAssertion = (xml: string) => void;

export type WaitForSceneGraphAssertionOptions = {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
};

export const checkDevice = async (context: RokuContext): Promise<DeviceSummary> => {
  const deviceInfo = await fetchText(context, "/query/device-info");
  const installerStatus = await fetchInstallerStatus(context);

  return {
    ecp: `http://${context.target}:${ecpPort}`,
    installerStatus,
    model: readXmlTag(deviceInfo, "model-name") ?? "unknown model",
    name:
      readXmlTag(deviceInfo, "friendly-device-name") ??
      readXmlTag(deviceInfo, "friendlyName") ??
      "unknown",
  };
};

export const getDeviceInfo = async (context: RokuContext) =>
  await rokuDeploy.getDeviceInfo({
    enhance: true,
    host: context.target,
    remotePort: ecpPort,
    timeout: context.timeoutMs,
  });

export const queryActiveApp = async (context: RokuContext): Promise<ActiveApp> =>
  readActiveApp(await fetchText(context, "/query/active-app"));

export const waitForActiveApp = async (
  context: RokuContext,
  appId: string,
  timeoutMs = 10_000,
): Promise<ActiveApp> => {
  const start = Date.now();
  let lastApp: ActiveApp | undefined;
  let lastError: string | undefined;

  while (Date.now() - start < timeoutMs) {
    try {
      lastApp = await queryActiveApp(context);
      lastError = undefined;
    } catch (error) {
      lastError = formatErrorMessage(error);
      await sleep(500);
      continue;
    }

    if (lastApp.id === appId) {
      return lastApp;
    }

    await sleep(500);
  }

  const last = lastApp ? `${lastApp.id} ${lastApp.name}` : "unknown";
  const errorSuffix = lastError ? `; last ECP error: ${lastError}` : "";
  throw new Error(`expected active app ${appId}, got ${last}${errorSuffix}`);
};

export const launchApp = async (
  context: RokuContext,
  appId: string,
  params: ReadonlyMap<string, string> = new Map(),
): Promise<ActiveApp> => {
  const url = ecpUrl(context, `/launch/${encodeURIComponent(appId)}`);

  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }

  await postLaunchMaybeAccepted(context, url);
  return await waitForActiveApp(context, appId);
};

export const pressKey = async (context: RokuContext, key: string): Promise<void> => {
  validateRemoteKey(key);
  await postOk(context, ecpUrl(context, `/keypress/${encodeURIComponent(key)}`));
};

export const queryEcp = async (context: RokuContext, path: string): Promise<string> =>
  await fetchText(context, path.startsWith("/") ? path : `/${path}`);

export const queryMediaPlayerXml = async (context: RokuContext): Promise<string> =>
  await queryEcp(context, "/query/media-player");

export const queryMediaPlayer = async (context: RokuContext): Promise<MediaPlayerInfo> =>
  readMediaPlayerInfo(await queryMediaPlayerXml(context));

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
  state === "buffer" || state === "pause" || state === "play";

export const waitForMediaPlayerState = async (
  context: RokuContext,
  expectedState: MediaPlayerState,
  timeoutMs = 10_000,
): Promise<MediaPlayerInfo> => {
  const start = Date.now();
  let lastState: string | undefined;
  let lastError: string | undefined;

  while (Date.now() - start < timeoutMs) {
    try {
      const mediaPlayer = await queryMediaPlayer(context);
      lastState = mediaPlayer.state;
      lastError = undefined;

      if (mediaPlayer.state === expectedState) {
        return mediaPlayer;
      }
    } catch (error) {
      lastError = formatErrorMessage(error);
    }

    await sleep(500);
  }

  const suffix = lastError ? `; last ECP error: ${lastError}` : "";
  throw new Error(
    `expected media-player state ${expectedState}, got ${lastState ?? "unknown"}${suffix}`,
  );
};

export const querySceneGraph = async (
  context: RokuContext,
  options: RetryOptions = {},
): Promise<string> => {
  const attempts = options.attempts ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await queryEcp(context, "/query/sgnodes/all");
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(`SceneGraph query failed: ${formatErrorMessage(lastError)}`);
};

export const assertSceneGraphNode = async (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
): Promise<void> => {
  assertNamedNode(await querySceneGraph(context), nodeName, expectation);
};

export const waitForSceneGraphNode = async (
  context: RokuContext,
  nodeName: string,
  expectation: NodeExpectation,
  timeoutMs = 30_000,
): Promise<void> => {
  const start = Date.now();
  let lastError: string | undefined;

  while (Date.now() - start < timeoutMs) {
    try {
      await assertSceneGraphNode(context, nodeName, expectation);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(500);
  }

  const suffix = lastError ? `; last observation: ${lastError}` : "";
  throw new Error(`expected SceneGraph node "${nodeName}" to match condition${suffix}`);
};

export const waitForSceneGraphAssertion = async (
  context: RokuContext,
  description: string,
  assertXml: SceneGraphAssertion,
  options: WaitForSceneGraphAssertionOptions = {},
): Promise<string> => {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const start = Date.now();
  let lastError: string | undefined;

  while (Date.now() - start < timeoutMs) {
    try {
      const xml = await querySceneGraph(context);
      assertXml(xml);
      return xml;
    } catch (error) {
      lastError = formatErrorMessage(error);
    }

    await sleep(pollIntervalMs);
  }

  const suffix = lastError ? `; last observation: ${lastError}` : "";
  throw new Error(`${description}${suffix}`);
};

export const installPackage = async (
  context: RokuContext & { readonly password: string },
  zipPath: string,
): Promise<string> => {
  const resolvedZip = resolve(zipPath);
  const extension = extname(resolvedZip);
  const result = await rokuDeploy.publish({
    host: context.target,
    outDir: dirname(resolvedZip),
    outFile: basename(resolvedZip, extension),
    password: context.password,
    rootDir: process.cwd(),
    username: context.username,
  });

  return result.message;
};

export const takeScreenshot = async (
  context: RokuContext & { readonly password: string },
  outputPath: string,
): Promise<string> => {
  const resolvedOutput = resolve(outputPath);
  const extension = extname(resolvedOutput);

  return await rokuDeploy.takeScreenshot({
    host: context.target,
    outDir: dirname(resolvedOutput),
    outFile: basename(resolvedOutput, extension),
    password: context.password,
  });
};

export const validateRemoteKey = (key: string): void => {
  if (key.startsWith("Lit_")) {
    return;
  }

  if (!remoteKeySet.has(key)) {
    throw new Error(`unsupported remote key: ${key}`);
  }
};

const fetchInstallerStatus = async (context: RokuContext): Promise<number> => {
  const response = await fetch(`http://${context.target}`, {
    signal: AbortSignal.timeout(context.timeoutMs),
  });

  return response.status;
};

const fetchText = async (context: RokuContext, path: string): Promise<string> => {
  const response = await fetch(ecpUrl(context, path), {
    signal: AbortSignal.timeout(context.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`GET ${path} returned HTTP ${response.status}`);
  }

  return await response.text();
};

const postOk = async (context: RokuContext, url: URL): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(context.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`POST ${url.pathname} returned HTTP ${response.status}`);
  }
};

const postLaunchMaybeAccepted = async (context: RokuContext, url: URL): Promise<void> => {
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(context.timeoutMs),
    });

    if (!response.ok && response.status !== 503) {
      throw new Error(`POST ${url.pathname} returned HTTP ${response.status}`);
    }
  } catch (error) {
    const message = formatErrorMessage(error).toLowerCase();
    if (
      !message.includes("abort") &&
      !message.includes("timeout") &&
      !message.includes("fetch failed")
    ) {
      throw error;
    }
  }
};

const ecpUrl = (context: RokuContext, path: string): URL =>
  new URL(path, `http://${context.target}:${ecpPort}`);

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
