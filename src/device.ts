import { Effect } from "effect";
import * as rokuDeploy from "roku-deploy";
import type { DeviceInfo } from "roku-deploy";
import { ecpPort, fetchEcpTextEffect } from "./ecp.js";
import { normalizeError } from "./errors.js";
import type { RokuContext } from "./roku-context.js";
import { readXmlTag } from "./xml.js";

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
  return yield* Effect.tryPromise({
    catch: normalizeError,
    try: () =>
      rokuDeploy.getDeviceInfo({
        enhance: true,
        host: context.target,
        remotePort: ecpPort,
        timeout: context.timeoutMs,
      }),
  });
});

export const getDeviceInfo = async (context: RokuContext): Promise<DeviceInfo> =>
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
