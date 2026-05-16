import { readXmlAttribute, readXmlTag } from "./xml.js";

export type NodeState = "absent" | "hidden" | "visible";
export type SceneGraphBounds = readonly [x: number, y: number, width: number, height: number];
export type SceneGraphPoint = readonly [x: number, y: number];
export type SceneGraphStatus = {
  readonly error?: string;
  readonly status?: string;
};

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

export const readNamedNodeNumber = (
  xml: string,
  nodeName: string,
  attributeName: string,
): number | undefined => {
  const value = readNamedNodeAttribute(xml, nodeName, attributeName);

  if (value !== undefined) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (attributeName !== "width" && attributeName !== "height") {
    return undefined;
  }

  const bounds = readNamedNodeBounds(xml, nodeName);

  if (!bounds) {
    return undefined;
  }

  return attributeName === "width" ? bounds[2] : bounds[3];
};

export const readNamedNodeBounds = (
  xml: string,
  nodeName: string,
): SceneGraphBounds | undefined => {
  const bounds = readNamedNodeAttribute(xml, nodeName, "bounds");

  if (!bounds) {
    return undefined;
  }

  const parts = parseSceneGraphNumberList(bounds);

  if (parts.length < 4) {
    return undefined;
  }

  return [parts[0], parts[1], parts[2], parts[3]];
};

export const readNamedNodeTranslation = (
  xml: string,
  nodeName: string,
): SceneGraphPoint | undefined => {
  const translation = readNamedNodeAttribute(xml, nodeName, "translation");

  if (!translation) {
    return undefined;
  }

  const parts = parseSceneGraphNumberList(translation);

  if (parts.length < 2) {
    return undefined;
  }

  return [parts[0], parts[1]];
};

export const readSceneGraphStatus = (xml: string): SceneGraphStatus => ({
  error: readXmlTag(xml, "error"),
  status: readXmlTag(xml, "status"),
});

export const readSceneGraphFailure = (xml: string): string | undefined => {
  const { error, status } = readSceneGraphStatus(xml);

  return status === "FAILED" ? (error ?? "unknown") : undefined;
};

export const isNamedNodeVisible = (xml: string, nodeName: string): boolean => {
  const attributes = readNamedNodeAttributes(xml, nodeName);

  return attributes !== undefined && !attributes.includes('visible="false"');
};

export const assertSceneGraphNumberNear = (
  actual: number | undefined,
  expected: number,
  label: string,
  tolerance = 1,
): void => {
  if (actual === undefined || Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ${label} ${expected}, got ${actual ?? "missing"}`);
  }
};

export const assertNamedNodeTranslation = (
  xml: string,
  nodeName: string,
  expectedX: number,
  expectedY: number,
  tolerance = 1,
): void => {
  const translation = readNamedNodeTranslation(xml, nodeName);

  assertSceneGraphNumberNear(translation?.[0], expectedX, `${nodeName} x`, tolerance);
  assertSceneGraphNumberNear(translation?.[1], expectedY, `${nodeName} y`, tolerance);
};

export const assertNamedNodeSize = (
  xml: string,
  nodeName: string,
  expectedWidth: number,
  expectedHeight: number,
  tolerance = 1,
): void => {
  assertSceneGraphNumberNear(
    readNamedNodeNumber(xml, nodeName, "width"),
    expectedWidth,
    `${nodeName} width`,
    tolerance,
  );
  assertSceneGraphNumberNear(
    readNamedNodeNumber(xml, nodeName, "height"),
    expectedHeight,
    `${nodeName} height`,
    tolerance,
  );
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

export const parseSceneGraphNumberList = (value: string): number[] =>
  value
    .replace(/[[\]{}]/g, "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
