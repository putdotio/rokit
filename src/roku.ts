import * as rokuDeploy from "roku-deploy";
import { basename, dirname, extname, resolve } from "node:path";
import { readActiveApp, readXmlTag, type ActiveApp } from "./xml.js";

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

export const launchApp = async (
  context: RokuContext,
  appId: string,
  params: ReadonlyMap<string, string> = new Map(),
): Promise<ActiveApp> => {
  const url = ecpUrl(context, `/launch/${encodeURIComponent(appId)}`);

  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }

  await postOk(context, url);
  return await waitForActiveApp(context, appId);
};

export const pressKey = async (context: RokuContext, key: string): Promise<void> => {
  validateRemoteKey(key);
  await postOk(context, ecpUrl(context, `/keypress/${encodeURIComponent(key)}`));
};

export const queryEcp = async (context: RokuContext, path: string): Promise<string> =>
  await fetchText(context, path.startsWith("/") ? path : `/${path}`);

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

const waitForActiveApp = async (
  context: RokuContext,
  appId: string,
  timeoutMs = 10_000,
): Promise<ActiveApp> => {
  const start = Date.now();
  let lastApp: ActiveApp | undefined;

  while (Date.now() - start < timeoutMs) {
    lastApp = await queryActiveApp(context);

    if (lastApp.id === appId) {
      return lastApp;
    }

    await sleep(500);
  }

  const last = lastApp ? `${lastApp.id} ${lastApp.name}` : "unknown";
  throw new Error(`expected active app ${appId}, got ${last}`);
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

const ecpUrl = (context: RokuContext, path: string): URL =>
  new URL(path, `http://${context.target}:${ecpPort}`);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
