import { createHash } from "node:crypto";
import { Effect, Random } from "effect";

export type DigestChallenge = {
  readonly nonce: string;
  readonly opaque?: string;
  readonly qop?: string;
  readonly realm: string;
};

export type DigestAuthContext = {
  readonly password: string;
  readonly username: string;
};

export const digestAuthHeaderEffect: (
  context: DigestAuthContext,
  method: string,
  uri: string,
  challenge: DigestChallenge,
) => Effect.Effect<string> = Effect.fn("digestAuthHeader")(
  function* (context, method, uri, challenge) {
    const ha1 = md5(`${context.username}:${challenge.realm}:${context.password}`);
    const ha2 = md5(`${method}:${uri}`);
    const parts = [
      `username="${escapeDigestValue(context.username)}"`,
      `realm="${escapeDigestValue(challenge.realm)}"`,
      `nonce="${escapeDigestValue(challenge.nonce)}"`,
      `uri="${escapeDigestValue(uri)}"`,
    ];

    if (challenge.qop === "auth") {
      const qop = challenge.qop;
      const nc = "00000001";
      const cnonce = yield* randomHex(8);
      const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
      parts.push(`response="${response}"`, `qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    } else {
      parts.push(`response="${md5(`${ha1}:${challenge.nonce}:${ha2}`)}"`);
    }

    if (challenge.opaque !== undefined) {
      parts.push(`opaque="${escapeDigestValue(challenge.opaque)}"`);
    }

    return `Digest ${parts.join(", ")}`;
  },
);

export const parseDigestChallenge = (header: string | null): DigestChallenge | undefined => {
  if (header === null || !header.toLowerCase().startsWith("digest ")) {
    return undefined;
  }

  const realm = readDigestParam(header, "realm");
  const nonce = readDigestParam(header, "nonce");

  if (realm === undefined || nonce === undefined) {
    return undefined;
  }

  return {
    nonce,
    opaque: readDigestParam(header, "opaque"),
    qop: normalizeQop(readDigestParam(header, "qop")),
    realm,
  };
};

const randomHex = Effect.fn("randomHex")(function* (byteCount: number) {
  let hex = "";
  for (let index = 0; index < byteCount; index += 1) {
    const byte = yield* Random.nextIntBetween(0, 255);
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
});

const readDigestParam = (header: string, name: string): string | undefined => {
  const match = new RegExp(`${name}=(?:"([^"]*)"|([^,\\s]*))`, "i").exec(header);
  return match?.[1] ?? match?.[2];
};

const normalizeQop = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry === "auth");
};

const md5 = (value: string): string => createHash("md5").update(value).digest("hex");

const escapeDigestValue = (value: string): string => value.replace(/(["\\])/g, "\\$1");
