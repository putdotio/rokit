import { Effect } from "effect";
import { ecpPort, fetchEcpTextEffect } from "./ecp.js";
import { normalizeError } from "./errors.js";
import type { RokuContext } from "./roku-context.js";
import { readXmlTag } from "./xml.js";

export type DeviceInfoValue = boolean | number | string;
export type DeviceInfo = Readonly<Record<string, DeviceInfoValue>>;

export type DeviceSummary = {
  readonly ecp: string;
  readonly installerStatus: number;
  readonly model: string;
  readonly name: string;
};

export const checkDeviceEffect = Effect.fn("checkDevice")(function* (context: RokuContext) {
  const deviceInfo = yield* fetchEcpTextEffect(context, "/query/device-info").pipe(
    Effect.mapError(normalizeError),
  );
  const installerStatus = yield* fetchInstallerStatusEffect(context);

  return {
    ecp: `http://${context.target}:${ecpPort}`,
    installerStatus,
    model: readXmlTag(deviceInfo, "model-name") ?? "unknown model",
    name:
      readXmlTag(deviceInfo, "friendly-device-name") ??
      readXmlTag(deviceInfo, "friendlyName") ??
      "unknown",
  };
});

export const checkDevice = async (context: RokuContext): Promise<DeviceSummary> =>
  await Effect.runPromise(checkDeviceEffect(context));

export const getDeviceInfoEffect = Effect.fn("getDeviceInfo")(function* (context: RokuContext) {
  const deviceInfo = yield* fetchEcpTextEffect(context, "/query/device-info").pipe(
    Effect.mapError(normalizeError),
  );

  return parseDeviceInfo(deviceInfo);
});

export const getDeviceInfo = async (context: RokuContext) =>
  await Effect.runPromise(getDeviceInfoEffect(context));

const fetchInstallerStatusEffect = Effect.fn("fetchInstallerStatus")(function* (
  context: RokuContext,
) {
  const response = yield* Effect.tryPromise({
    catch: normalizeError,
    try: () =>
      fetch(`http://${context.target}`, {
        signal: AbortSignal.timeout(context.timeoutMs),
      }),
  });

  return response.status;
});

const parseDeviceInfo = (xml: string): DeviceInfo => {
  const values: Record<string, DeviceInfoValue> = {};
  const pattern = /<([a-zA-Z0-9-]+)>([^<]*)<\/\1>/g;

  for (const match of xml.matchAll(pattern)) {
    const key = match[1];
    const value = match[2];

    if (key !== undefined && value !== undefined && key !== "device-info") {
      values[toCamelCase(key)] = normalizeDeviceInfoValue(decodeXmlEntities(value));
    }
  }

  return values;
};

const toCamelCase = (value: string): string =>
  value.replace(/-([a-zA-Z0-9])/g, (_match: string, character: string) => character.toUpperCase());

const normalizeDeviceInfoValue = (value: string): DeviceInfoValue => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const numericValue = Number(value);
  if (value.trim() !== "" && Number.isFinite(numericValue)) {
    return numericValue;
  }

  return value;
};

const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|apos|gt|lt|quot);/g, (entity, body: string) => {
    if (body === "amp") {
      return "&";
    }
    if (body === "apos") {
      return "'";
    }
    if (body === "gt") {
      return ">";
    }
    if (body === "lt") {
      return "<";
    }
    if (body === "quot") {
      return '"';
    }
    if (body.startsWith("#x")) {
      return codePointEntity(entity, Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return codePointEntity(entity, Number.parseInt(body.slice(1), 10));
    }

    return entity;
  });

const codePointEntity = (fallback: string, codePoint: number): string => {
  if (!Number.isInteger(codePoint)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
};
