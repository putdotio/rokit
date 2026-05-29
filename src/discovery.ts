import { createSocket, type Socket } from "node:dgram";
import { Effect } from "effect";
import { InvalidInput, normalizeError, type RokitError } from "./errors.js";

export type DiscoveredRokuDevice = {
  readonly location: string;
  readonly server?: string;
  readonly target?: string;
  readonly usn?: string;
};

export const discoverRokuDevicesEffect = Effect.fn("discoverRokuDevices")(function* (
  timeoutMs = 3_000,
) {
  const safeTimeoutMs = yield* validateDiscoveryTimeoutEffect(timeoutMs);
  return yield* discoverWithSsdpEffect(safeTimeoutMs);
});

export const discoverRokuDevices = async (
  timeoutMs = 3_000,
): Promise<readonly DiscoveredRokuDevice[]> =>
  await Effect.runPromise(discoverRokuDevicesEffect(timeoutMs));

const ssdpSearchRequest = [
  "M-SEARCH * HTTP/1.1",
  "HOST: 239.255.255.250:1900",
  'MAN: "ssdp:discover"',
  "MX: 1",
  "ST: roku:ecp",
  "",
  "",
].join("\r\n");

const validateDiscoveryTimeoutEffect = Effect.fn("validateDiscoveryTimeout")(function* (
  timeoutMs: number,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return yield* Effect.fail(
      InvalidInput.make({ message: `Invalid discovery timeout: ${timeoutMs}` }),
    );
  }

  return timeoutMs;
});

const discoverWithSsdpEffect = Effect.fn("discoverWithSsdp")(function* (timeoutMs: number) {
  return yield* Effect.callback<readonly DiscoveredRokuDevice[], RokitError>((resume) => {
    const socket = createSocket("udp4");
    const devices = new Map<string, DiscoveredRokuDevice>();
    let finished = false;

    const complete = (effect: Effect.Effect<readonly DiscoveredRokuDevice[], RokitError>) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      closeSocket(socket);
      resume(effect);
    };

    const timer = setTimeout(() => {
      complete(Effect.succeed([...devices.values()]));
    }, timeoutMs);

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

    socket.once("error", (error) => {
      complete(Effect.fail(normalizeError(error)));
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(Buffer.from(ssdpSearchRequest), 1900, "239.255.255.250", (error) => {
          if (error) {
            complete(Effect.fail(normalizeError(error)));
          }
        });
      } catch (error) {
        complete(Effect.fail(normalizeError(error)));
      }
    });

    return Effect.sync(() => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        closeSocket(socket);
      }
    });
  });
});

export const readSsdpHeaders = (text: string): ReadonlyMap<string, string> => {
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

const closeSocket = (socket: Socket): void => {
  try {
    socket.close();
  } catch {
    // The socket may already be closed after an error or interrupt.
  }
};
