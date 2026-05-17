import * as rokuDeploy from "roku-deploy";
import { createSocket } from "node:dgram";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { assertNamedNode, isCompleteSceneGraph, type NodeExpectation } from "./scenegraph.js";
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

export type DiscoveredRokuDevice = {
  readonly location: string;
  readonly server?: string;
  readonly target?: string;
  readonly usn?: string;
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
  readonly requireComplete?: boolean;
  readonly retryDelayMs?: number;
};

export type SceneGraphAssertion = (xml: string) => void;

export type WaitForSceneGraphAssertionOptions = {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
};

export type PackageResult = {
  readonly path: string;
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

export const discoverRokuDevices = async (timeoutMs = 3_000): Promise<DiscoveredRokuDevice[]> =>
  await new Promise((resolveDevices, reject) => {
    const socket = createSocket("udp4");
    const devices = new Map<string, DiscoveredRokuDevice>();
    const request = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 1",
      "ST: roku:ecp",
      "",
      "",
    ].join("\r\n");

    const finish = () => {
      socket.close();
      resolveDevices([...devices.values()]);
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on("message", (message) => {
      const headers = readSsdpHeaders(message.toString("utf8"));
      const location = headers.get("location");

      if (!location) {
        return;
      }

      devices.set(location, {
        location,
        server: headers.get("server"),
        target: readLocationTarget(location),
        usn: headers.get("usn"),
      });
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(Buffer.from(request), 1900, "239.255.255.250", (error) => {
        if (error) {
          clearTimeout(timer);
          socket.close();
          reject(error);
        }
      });
    });
  });

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

export const queryEcp = async (context: RokuContext, path: string): Promise<string> => {
  const safePath = validateEcpPath(path);
  return await fetchText(context, safePath.startsWith("/") ? safePath : `/${safePath}`);
};

export const queryMediaPlayerXml = async (context: RokuContext): Promise<string> =>
  await queryEcp(context, "/query/media-player");

export const queryMediaPlayer = async (context: RokuContext): Promise<MediaPlayerInfo> =>
  readMediaPlayerInfo(await queryMediaPlayerXml(context));

export const queryMediaPlayerXmlSafe = async (
  context: RokuContext,
): Promise<string | undefined> => {
  try {
    return await queryMediaPlayerXml(context);
  } catch {
    return undefined;
  }
};

export const queryMediaPlayerSafe = async (
  context: RokuContext,
): Promise<MediaPlayerInfo | undefined> => {
  const xml = await queryMediaPlayerXmlSafe(context);
  return xml === undefined ? undefined : readMediaPlayerInfo(xml);
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

export const assertMediaPlayerContainer = async (
  context: RokuContext,
  expectedContainer: string,
): Promise<MediaPlayerInfo> => {
  const mediaPlayer = await queryMediaPlayer(context);

  if (mediaPlayer.container !== expectedContainer) {
    throw new Error(
      `expected media-player container ${expectedContainer}, got ${mediaPlayer.container ?? "unknown"}`,
    );
  }

  return mediaPlayer;
};

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
  const requireComplete = options.requireComplete ?? false;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let lastXml = "";
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const xml = await queryEcp(context, "/query/sgnodes/all");
      if (!requireComplete || isCompleteSceneGraph(xml)) {
        return xml;
      }

      lastXml = xml;
    } catch (error) {
      lastError = error;
      lastXml = "";
    }

    if (attempt < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  if (lastXml !== "") {
    throw new Error("SceneGraph query returned incomplete XML");
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

export const packageChannel = async (
  outputPath: string,
  rootDir = process.cwd(),
): Promise<PackageResult> => {
  const options = packageOptions(outputPath, rootDir);

  await rokuDeploy.createPackage(options);

  return {
    path: rokuDeploy.getOutputZipFilePath(options),
  };
};

export const resolvePackageOutputPath = (outputPath: string, rootDir = process.cwd()): string => {
  const options = packageOptions(outputPath, rootDir);
  return rokuDeploy.getOutputZipFilePath(options);
};

const packageOptions = (outputPath: string, rootDir = process.cwd()) => {
  const resolvedRoot = resolve(rootDir);
  const resolvedOutput = isAbsolute(outputPath)
    ? resolve(outputPath)
    : resolve(resolvedRoot, outputPath);

  return {
    outDir: dirname(resolvedOutput),
    outFile: basename(resolvedOutput),
    rootDir: resolvedRoot,
  };
};

export const validateEcpPath = (path: string): string => {
  rejectUnsafeInput(path, "ECP path");

  if (path.includes("\\")) {
    throw new Error("ECP path must not include backslashes");
  }

  if (path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("ECP path must be device-relative");
  }

  if (path.includes("?") || path.includes("#")) {
    throw new Error("ECP path must not include query strings or fragments");
  }

  if (/(^|[/\\])\.\.($|[/\\])/.test(path)) {
    throw new Error("ECP path must not include path traversal");
  }

  if (/%(?:2e|2f|5c)/i.test(path)) {
    throw new Error("ECP path must not include percent-encoded path segments");
  }

  return path;
};

const rejectUnsafeInput = (value: string, label: string): void => {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`${label} contains control characters`);
  }
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

const readSsdpHeaders = (text: string): ReadonlyMap<string, string> => {
  const headers = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  return headers;
};

const readLocationTarget = (location: string): string | undefined => {
  try {
    return new URL(location).hostname;
  } catch {
    return undefined;
  }
};
