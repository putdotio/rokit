import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPackage: vi.fn(),
  getDeviceInfo: vi.fn(),
  getOutputZipFilePath: vi.fn(),
  publish: vi.fn(),
  takeScreenshot:
    vi.fn<(options: { readonly outDir: string; readonly outFile: string }) => Promise<string>>(),
}));

vi.mock("roku-deploy", () => mocks);

import { captureScreenshot, querySceneGraph, type RokuContext } from "../src/roku.js";

const context: RokuContext = {
  target: "192.0.2.1",
  timeoutMs: 100,
  username: "rokudev",
};

describe("Roku retry helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("can wait for a populated SceneGraph App node", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<sgnodes><All_Nodes><Default /></All_Nodes><status>OK</status></sgnodes>"),
      )
      .mockResolvedValueOnce(
        new Response("<sgnodes><All_Nodes><App /></All_Nodes><status>OK</status></sgnodes>"),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      querySceneGraph(context, {
        attempts: 2,
        requireAppNode: true,
        requireComplete: true,
        retryDelayMs: 1,
      }),
    ).resolves.toContain("<App");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("captures screenshots through a temp path and copies the requested output", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-capture-test-"));

    try {
      mocks.takeScreenshot.mockImplementationOnce(async (options) => {
        const outputPath = join(options.outDir, `${options.outFile}.jpg`);
        await writeFile(outputPath, "image");
        return outputPath;
      });

      const outputPath = join(root, "shots", "story.jpg");
      await expect(
        captureScreenshot({ ...context, password: "pass" }, outputPath, {
          attempts: 1,
          tempDirPrefix: "test capture",
        }),
      ).resolves.toBe(resolve(outputPath));
      await expect(access(outputPath)).resolves.toBeUndefined();
      await expect(readFile(outputPath, "utf8")).resolves.toBe("image");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
