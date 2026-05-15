import { readXmlAttribute } from "./xml.js";

export type NodeState = "absent" | "hidden" | "visible";

export type NodeExpectation =
  | {
      readonly state: NodeState;
      readonly text?: string;
    }
  | {
      readonly attribute: string;
      readonly value: string;
    };

export const readNamedNodeAttributes = (xml: string, nodeName: string): string | undefined => {
  const pattern = new RegExp(
    `<[A-Za-z0-9]+\\b(?=[^>]*\\bname="${escapeRegExp(nodeName)}")([^>]*)>`,
  );

  return pattern.exec(xml)?.[1];
};

export const readNamedNodeAttribute = (
  xml: string,
  nodeName: string,
  attributeName: string,
): string | undefined => {
  const attributes = readNamedNodeAttributes(xml, nodeName);

  if (!attributes) {
    return undefined;
  }

  return readXmlAttribute(attributes, attributeName);
};

export const isNamedNodeVisible = (xml: string, nodeName: string): boolean => {
  const attributes = readNamedNodeAttributes(xml, nodeName);

  return attributes !== undefined && !attributes.includes('visible="false"');
};

export const assertNamedNode = (
  xml: string,
  nodeName: string,
  expectation: NodeExpectation,
): void => {
  if ("attribute" in expectation) {
    assertNamedNodeAttribute(xml, nodeName, expectation.attribute, expectation.value);
    return;
  }

  assertNamedNodeState(xml, nodeName, expectation.state);

  if (expectation.text !== undefined) {
    assertNamedNodeText(xml, nodeName, expectation.text);
  }
};

export const assertNamedNodeState = (xml: string, nodeName: string, state: NodeState): void => {
  const attributes = readNamedNodeAttributes(xml, nodeName);

  if (state === "absent") {
    if (attributes !== undefined) {
      throw new Error(`expected SceneGraph node "${nodeName}" to be absent`);
    }

    return;
  }

  if (!attributes) {
    throw new Error(`expected SceneGraph node "${nodeName}"`);
  }

  if (state === "visible" && attributes.includes('visible="false"')) {
    throw new Error(`expected SceneGraph node "${nodeName}" to be visible`);
  }

  if (state === "hidden" && !attributes.includes('visible="false"')) {
    throw new Error(`expected SceneGraph node "${nodeName}" to be hidden`);
  }
};

export const assertNamedNodeText = (xml: string, nodeName: string, expectedText: string): void => {
  const text = readNamedNodeAttribute(xml, nodeName, "text");

  if (text !== expectedText) {
    throw new Error(`expected "${nodeName}" text "${expectedText}", got "${text ?? "missing"}"`);
  }
};

const assertNamedNodeAttribute = (
  xml: string,
  nodeName: string,
  attributeName: string,
  expectedValue: string,
): void => {
  const value = readNamedNodeAttribute(xml, nodeName, attributeName);

  if (value !== expectedValue) {
    throw new Error(
      `expected "${nodeName}" ${attributeName} "${expectedValue}", got "${value ?? "missing"}"`,
    );
  }
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
