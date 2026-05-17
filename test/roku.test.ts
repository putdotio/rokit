import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { queryEcp, resolvePackageOutputPath, type RokuContext } from "../src/roku.js";

const context: RokuContext = {
  target: "192.0.2.1",
  timeoutMs: 100,
  username: "rokudev",
};

describe("Roku helpers", () => {
  it("rejects off-device ECP paths at the library boundary", async () => {
    await expect(queryEcp(context, "//example.com/query/device-info")).rejects.toThrow(
      "ECP path must be device-relative",
    );
    await expect(queryEcp(context, "http://example.com/query/device-info")).rejects.toThrow(
      "ECP path must be device-relative",
    );
    await expect(queryEcp(context, "/\\example.com/query/device-info")).rejects.toThrow(
      "ECP path must not include backslashes",
    );
  });

  it("resolves relative package outputs against the package root", () => {
    const rootDir = resolve("tmp-roku-app");

    expect(resolvePackageOutputPath("out/channel", rootDir)).toBe(
      resolve(rootDir, "out/channel.zip"),
    );
  });
});
