import { describe, expect, it } from "vitest";
import {
  assertNamedNode,
  isNamedNodeVisible,
  parseSceneGraphNumberList,
  readNamedNodeAttribute,
  readNamedNodeBounds,
  readNamedNodeNumber,
  readNamedNodeTranslation,
} from "../src/scenegraph.js";

const xml = `
<All_Nodes>
  <Group name="videoPlayerScreen" visible="true" translation="[0,0]" />
  <Label name="title" text="Big Buck Bunny" />
  <Group name="osd" visible="false" />
  <Rectangle name="progressTrack" width="1728" height="10" />
  <Rectangle name="progressFill" bounds="{0, 23, 400, 12}" />
</All_Nodes>`;

describe("SceneGraph helpers", () => {
  it("reads named node attributes", () => {
    expect(readNamedNodeAttribute(xml, "title", "text")).toBe("Big Buck Bunny");
    expect(readNamedNodeAttribute(xml, "progressTrack", "height")).toBe("10");
    expect(readNamedNodeAttribute(xml, "missing", "text")).toBeUndefined();
  });

  it("reads numeric SceneGraph geometry", () => {
    expect(parseSceneGraphNumberList("{0, 23, 400, 12}")).toEqual([0, 23, 400, 12]);
    expect(readNamedNodeNumber(xml, "progressTrack", "width")).toBe(1728);
    expect(readNamedNodeNumber(xml, "progressFill", "height")).toBe(12);
    expect(readNamedNodeBounds(xml, "progressFill")).toEqual([0, 23, 400, 12]);
    expect(readNamedNodeTranslation(xml, "videoPlayerScreen")).toEqual([0, 0]);
    expect(readNamedNodeTranslation(xml, "missing")).toBeUndefined();
  });

  it("detects visible nodes", () => {
    expect(isNamedNodeVisible(xml, "videoPlayerScreen")).toBe(true);
    expect(isNamedNodeVisible(xml, "osd")).toBe(false);
    expect(isNamedNodeVisible(xml, "missing")).toBe(false);
  });

  it("asserts node state, text, and attributes", () => {
    expect(() => assertNamedNode(xml, "videoPlayerScreen", { state: "visible" })).not.toThrow();
    expect(() => assertNamedNode(xml, "osd", { state: "hidden" })).not.toThrow();
    expect(() => assertNamedNode(xml, "missing", { state: "absent" })).not.toThrow();
    expect(() =>
      assertNamedNode(xml, "title", { state: "visible", text: "Big Buck Bunny" }),
    ).not.toThrow();
    expect(() =>
      assertNamedNode(xml, "progressTrack", { attribute: "height", value: "10" }),
    ).not.toThrow();
  });

  it("throws compact expectation failures", () => {
    expect(() => assertNamedNode(xml, "osd", { state: "visible" })).toThrow(
      'expected SceneGraph node "osd" to be visible',
    );
    expect(() => assertNamedNode(xml, "title", { state: "absent" })).toThrow(
      'expected SceneGraph node "title" to be absent',
    );
    expect(() => assertNamedNode(xml, "title", { state: "visible", text: "Other" })).toThrow(
      'expected "title" text "Other", got "Big Buck Bunny"',
    );
  });
});
