import type { NodeCondition } from "./cli-types.js";
import { fail } from "./runtime.js";

export const nodeConditionStates: readonly ["visible", "hidden", "absent", "text", "attr"] = [
  "visible",
  "hidden",
  "absent",
  "text",
  "attr",
];

export type NodeConditionState = (typeof nodeConditionStates)[number];

export const isNodeConditionState = (value: string): value is NodeConditionState =>
  nodeConditionStates.some((state) => state === value);

export const makeNodeCondition = (
  commandName: string,
  nodeName: string,
  condition: NodeConditionState,
  value: string | undefined,
): NodeCondition => {
  if (condition === "visible" || condition === "hidden" || condition === "absent") {
    if (value !== undefined) {
      fail(`usage: rokit ${commandName} <node-name> ${condition}`);
    }

    return {
      expectation: { state: condition },
      nodeName,
    };
  }

  if (condition === "text") {
    if (value === undefined) {
      fail(`usage: rokit ${commandName} <node-name> text <expected-text>`);
    }

    return {
      expectation: { state: "visible", text: value },
      nodeName,
    };
  }

  if (value === undefined) {
    return fail(`usage: rokit ${commandName} <node-name> attr <name=value>`);
  }

  const equalsIndex = value.indexOf("=");

  if (equalsIndex <= 0) {
    return fail(`Invalid attr condition: ${value}`);
  }

  return {
    expectation: {
      attribute: value.slice(0, equalsIndex),
      value: value.slice(equalsIndex + 1),
    },
    nodeName,
  };
};

export const formatNodeCondition = ({ expectation, nodeName }: NodeCondition): string => {
  if ("attribute" in expectation) {
    return `${nodeName} attr ${expectation.attribute}=${expectation.value}`;
  }

  const suffix = expectation.text === undefined ? "" : ` text=${expectation.text}`;
  return `${nodeName} ${expectation.state}${suffix}`;
};

export const formatNodeData = ({ expectation, nodeName, timeoutMs }: NodeCondition) => ({
  expectation,
  nodeName,
  timeoutMs,
});
