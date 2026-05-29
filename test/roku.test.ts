import { resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { discoverRokuDevicesEffect, readSsdpHeaders } from "../src/discovery.js";
import { fetchEcpTextEffect, postEcpEffect } from "../src/ecp.js";
import {
  getDeviceInfo,
  pressKey,
  queryEcp,
  resolvePackageOutputPath,
  type RokuContext,
} from "../src/roku.js";

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

  it("rejects off-device ECP paths in public Effect helpers", async () => {
    await expect(
      Effect.runPromise(fetchEcpTextEffect(context, "//example.com/query/device-info")),
    ).rejects.toThrow("ECP path must be device-relative");
    await expect(
      Effect.runPromise(postEcpEffect(context, "http://example.com/keypress/Home")),
    ).rejects.toThrow("ECP path must be device-relative");
  });

  it("allows helper-generated encoded literal keypress paths", async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      fetchCalls.push(String(input));
      return new Response("");
    };

    try {
      await pressKey(context, "Lit_/");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toEqual(["http://192.0.2.1:8060/keypress/Lit_%2F"]);
  });

  it("reads enhanced device info through native ECP fetch", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          [
            "<device-info>",
            "<friendly-device-name>Living Room &amp; Lab</friendly-device-name>",
            "<is-tv>true</is-tv>",
            "<uptime>42</uptime>",
            "<model-name>Roku Ultra</model-name>",
            "</device-info>",
          ].join(""),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(getDeviceInfo(context)).resolves.toEqual({
        friendlyDeviceName: "Living Room & Lab",
        isTv: true,
        modelName: "Roku Ultra",
        uptime: 42,
      });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://192.0.2.1:8060/query/device-info");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves relative package outputs against the package root", () => {
    const rootDir = resolve("tmp-roku-app");

    expect(resolvePackageOutputPath("out/channel", rootDir)).toBe(
      resolve(rootDir, "out/channel.zip"),
    );
    expect(resolvePackageOutputPath("out/channel.dev", rootDir)).toBe(
      resolve(rootDir, "out/channel.dev.zip"),
    );
    expect(resolvePackageOutputPath("out/channel.squashfs", rootDir)).toBe(
      resolve(rootDir, "out/channel.squashfs"),
    );
  });

  it("parses SSDP headers case-insensitively", () => {
    const headers = readSsdpHeaders(
      [
        "HTTP/1.1 200 OK",
        "LOCATION: http://192.0.2.1:8060/",
        "Server: Roku/12.0 UPnP/1.0",
        "",
      ].join("\r\n"),
    );

    expect(headers.get("location")).toBe("http://192.0.2.1:8060/");
    expect(headers.get("server")).toBe("Roku/12.0 UPnP/1.0");
  });

  it("rejects invalid discovery timeouts at the Effect boundary", async () => {
    await expect(Effect.runPromise(discoverRokuDevicesEffect(0))).rejects.toThrow(
      "Invalid discovery timeout: 0",
    );
    await expect(Effect.runPromise(discoverRokuDevicesEffect(1.5))).rejects.toThrow(
      "Invalid discovery timeout: 1.5",
    );
  });
});
