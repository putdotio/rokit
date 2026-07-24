export const readInstallerMessage = (body: unknown): string => {
  const text = typeof body === "string" ? body : "";
  const fontMessages = readRedFontMessages(text);
  const fontFailure = fontMessages.findLast(isInstallerFailure);
  const rokuMessage = readRokuInstallerMessage(text);
  const fontSuccess = fontMessages.findLast(
    (message) => isInstallerSuccess(message) || isDeleteSuccess(message),
  );
  const fontProgress = fontMessages.at(-1);
  const fallback =
    text.trim() === ""
      ? "Empty Roku installer response"
      : `Unrecognized Roku installer response: ${text.trim().slice(0, 200)}`;

  return fontFailure ?? rokuMessage ?? fontSuccess ?? fontProgress ?? fallback;
};

export const isInstallerSuccess = (message: string): boolean =>
  isRecognizedInstallerMessage(message) &&
  (/\bsuccess(?:ful)?\b/i.test(message) ||
    /identical to previous version/i.test(message) ||
    /application received/i.test(message));

export const normalizeInstallSuccessMessage = (message: string): string =>
  /identical to previous version/i.test(message)
    ? "Identical to previous version -- not replacing"
    : "Successful deploy";

// Both are empty-developer-slot signals: newer devices report "no plugin
// installed", while older ones (e.g. Roku Stick 3500X) fail a delete/replace of
// an empty slot with "No such file or directory". Treating either as an empty
// slot makes delete idempotent and lets a Replace fall back to a fresh Install.
export const isEmptyDeveloperSlotMessage = (message: string): boolean =>
  /no plugin installed/i.test(message) || /no such file or directory/i.test(message);

export const isDeleteSuccess = (message: string): boolean =>
  isRecognizedInstallerMessage(message) &&
  (/\b(?:uninstall|delete|remove|deletion)\b.*\b(?:success(?:ful)?|succeeded)\b/i.test(message) ||
    isEmptyDeveloperSlotMessage(message));

const isRecognizedInstallerMessage = (message: string): boolean =>
  message !== "Empty Roku installer response" &&
  !message.startsWith("Unrecognized Roku installer response:");

const readRedFontMessages = (body: string): readonly string[] => {
  const messages: string[] = [];
  const pattern = /<font\b(?=[^>]*\bcolor\s*=\s*(?:"red"|'red'|red))[^>]*>(.*?)<\/font>/gis;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const message = normalizeHtmlMessage(match[1] ?? "");
    if (message !== "") {
      messages.push(message);
    }
  }

  return messages;
};

const normalizeHtmlMessage = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isInstallerFailure = (message: string): boolean =>
  /\b(?:fail(?:ed|ure)?|error|reject(?:ed)?|compile)\b/i.test(message);

const readRokuInstallerMessage = (body: string): string | undefined => {
  if (/install\sfailure:\scompilation\sfailed/i.test(body)) {
    return "Install failure: compilation failed";
  }
  if (/["']\s*Failed\s*to\s*check\s*for\s*software\s*update\s*["']/i.test(body)) {
    return "Failed to check for software update";
  }

  const messages = readRokuJsMessages(body);
  return messages.errors[0] ?? messages.successes[0];
};

const readRokuJsMessages = (
  body: string,
): {
  readonly errors: readonly string[];
  readonly successes: readonly string[];
} => {
  const errors: string[] = [];
  const successes: string[] = [];
  const messagePattern =
    /Shell\.create\('Roku\.Message'\)\.trigger\('[\w\s]+',\s+'(\w+)'\)\.trigger\('[\w\s]+',\s+'(.*?)'\)/gims;
  let match: RegExpExecArray | null;

  while ((match = messagePattern.exec(body)) !== null) {
    const type = match[1]?.toLowerCase();
    const message = match[2];

    if (message === undefined) {
      continue;
    }

    if (type === "error") {
      errors.push(message);
    } else if (type === "success") {
      successes.push(message);
    }
  }

  const jsonPattern = /JSON\.parse\(('(?:\\.|[^'\\])*')\);/gim;
  let jsonMatch: RegExpExecArray | null;

  while ((jsonMatch = jsonPattern.exec(body)) !== null) {
    const literal = jsonMatch[1];
    if (literal === undefined) {
      continue;
    }

    const parsed = parseRokuJsonPayload(literal);
    const messages = readRokuJsonMessages(parsed);
    errors.push(...messages.errors);
    successes.push(...messages.successes);
  }

  return { errors, successes };
};

const parseRokuJsonPayload = (literal: string): unknown => {
  try {
    return JSON.parse(parseSingleQuotedJsString(literal));
  } catch {
    return undefined;
  }
};

const parseSingleQuotedJsString = (literal: string): string => {
  const input = literal.slice(1, -1);
  let output = "";

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== "\\") {
      output += character;
      continue;
    }

    const escaped = input[index + 1];
    index += 1;

    switch (escaped) {
      case "\\":
      case "'":
      case '"':
      case "/":
        output += escaped;
        break;
      case "b":
        output += "\b";
        break;
      case "f":
        output += "\f";
        break;
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "t":
        output += "\t";
        break;
      case "u": {
        const hex = input.slice(index + 1, index + 5);
        output += /^[0-9a-f]{4}$/i.test(hex)
          ? String.fromCharCode(Number.parseInt(hex, 16))
          : `\\u${hex}`;
        index += 4;
        break;
      }
      default:
        output += escaped ?? "";
        break;
    }
  }

  return output;
};

const readRokuJsonMessages = (
  payload: unknown,
): {
  readonly errors: readonly string[];
  readonly successes: readonly string[];
} => {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    return { errors: [], successes: [] };
  }

  const errors: string[] = [];
  const successes: string[] = [];

  for (const message of payload.messages) {
    if (!isRecord(message)) {
      continue;
    }

    const type = typeof message.type === "string" ? message.type.toLowerCase() : "";
    const text = typeof message.text === "string" ? message.text : undefined;
    const textType = message.text_type;

    if (text === undefined || textType !== "text") {
      continue;
    }

    if (type === "error") {
      errors.push(text);
    } else if (type === "success") {
      successes.push(text);
    }
  }

  return { errors, successes };
};

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);
