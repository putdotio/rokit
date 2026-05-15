export type ActiveApp = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly version: string;
};

export const readXmlTag = (xml: string, tag: string): string | undefined => {
  const pattern = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  return pattern.exec(xml)?.[1]?.trim();
};

export const readXmlAttribute = (attributes: string, name: string): string | undefined => {
  const pattern = new RegExp(`${name}="([^"]*)"`);
  return pattern.exec(attributes)?.[1];
};

export const readActiveApp = (xml: string): ActiveApp => {
  const match = /<app(?:\s+([^>]*))?>([^<]*)<\/app>/.exec(xml);

  if (!match) {
    throw new Error("active app response did not include an app node");
  }

  const attributes = match[1] ?? "";

  return {
    id: readXmlAttribute(attributes, "id") ?? "",
    name: match[2]?.trim() ?? "",
    type: readXmlAttribute(attributes, "type") ?? "",
    version: readXmlAttribute(attributes, "version") ?? "",
  };
};
