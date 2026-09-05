import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  captureScreenshot,
  deleteInstalledChannel,
  installPackage,
  querySceneGraph,
  type RokuContext,
} from "../src/roku.js";

import { jpegImage, pngImage } from "./fixtures/images.js";

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

  it.each([
    ["jpg", jpegImage],
    ["png", pngImage],
  ] as const)(
    "captures %s screenshots through a temp path and copies the requested output",
    async (extension, image) => {
      const root = await mkdtemp(join(tmpdir(), "rokit-capture-test-"));

      try {
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response("", {
              headers: {
                "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
              },
              status: 401,
            }),
          )
          .mockResolvedValueOnce(
            new Response(
              `<html><a href="pkgs/dev.${extension}?cache=1&amp;size=1280">screenshot</a></html>`,
            ),
          )
          .mockResolvedValueOnce(new Response(Uint8Array.from(image)));
        vi.stubGlobal("fetch", fetchMock);

        const outputPath = join(root, "shots", "story.jpg");
        await expect(
          captureScreenshot({ ...context, password: "pass" }, outputPath, {
            attempts: 1,
            tempDirPrefix: "test capture",
          }),
        ).resolves.toBe(resolve(outputPath));
        await expect(access(outputPath)).resolves.toBeUndefined();
        await expect(readFile(outputPath)).resolves.toEqual(image);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://192.0.2.1/plugin_inspect");
        expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
          `http://192.0.2.1/pkgs/dev.${extension}?cache=1&size=1280`,
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects an HTML screenshot response without writing an artifact after bounded retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-invalid-capture-"));
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        calls += 1;
        if (calls % 3 === 1)
          return new Response("", {
            status: 401,
            headers: { "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"' },
          });
        if (calls % 3 === 2) return new Response('<a href="pkgs/dev.jpg?cache=1">screenshot</a>');
        return new Response("<html>error page</html>", {
          headers: { "Content-Type": "image/jpeg" },
        });
      }),
    );
    try {
      const outputPath = join(root, "shot.jpg");
      await expect(
        captureScreenshot({ ...context, password: "pass" }, outputPath, {
          attempts: 2,
          retryDelayMs: 1,
        }),
      ).rejects.toThrow("invalid screenshot image");
      expect(calls).toBe(6);
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces the underlying screenshot failure after retries are exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-capture-test-"));

    try {
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("transport detail"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        captureScreenshot({ ...context, password: "pass" }, join(root, "story.jpg"), {
          attempts: 2,
          retryDelayMs: 1,
        }),
      ).rejects.toThrow("failed to capture story.jpg: transport detail");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("deletes the installed developer channel through the native Roku installer form", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          headers: {
            "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
          },
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response('<font color="red">Uninstall Success.</font>'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteInstalledChannel({ ...context, password: "pass" })).resolves.toBe(
      "Uninstall Success.",
    );

    const challengeRequest = fetchMock.mock.calls[0];
    expect(String(challengeRequest?.[0])).toBe("http://192.0.2.1/plugin_install");
    expect(challengeRequest?.[1]?.method).toBe("GET");
    expect(challengeRequest?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const request = fetchMock.mock.calls[1];
    const init = request?.[1];
    expect(String(request?.[0])).toBe("http://192.0.2.1/plugin_install");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(readAuthorization(init)).toContain('Digest username="rokudev"');
    expect(readAuthorization(init)).toContain('realm="rokudev"');
    expect(readAuthorization(init)).toContain('nonce="nonce"');

    if (!(init?.body instanceof FormData)) {
      throw new Error("expected FormData request body");
    }

    expect(init.body.get("mysubmit")).toBe("Delete");
    expect(init.body.get("archive")).toBe("");
  });

  it("accepts Roku's Delete Succeeded response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          headers: {
            "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
          },
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response('<font color="red">Delete Succeeded.</font>'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteInstalledChannel({ ...context, password: "pass" })).resolves.toBe(
      "Delete Succeeded.",
    );
  });

  it("supports qop-less Digest installer challenges", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          headers: {
            "WWW-Authenticate": 'Digest realm="rokudev", nonce="nonce"',
          },
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response('<font color="red">Uninstall Success.</font>'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteInstalledChannel({ ...context, password: "pass" })).resolves.toBe(
      "Uninstall Success.",
    );

    const authorization = readAuthorization(fetchMock.mock.calls[1]?.[1]);
    expect(authorization).toContain('Digest username="rokudev"');
    expect(authorization).toContain('response="');
    expect(authorization).not.toContain("qop=");
    expect(authorization).not.toContain("nc=");
    expect(authorization).not.toContain("cnonce=");
  });

  it("rejects delete responses that are not installer successes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          headers: {
            "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
          },
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response("<html>not deleted</html>"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteInstalledChannel({ ...context, password: "pass" })).rejects.toThrow(
      "Unrecognized Roku installer response",
    );
  });

  it("installs a package through the native Roku installer form", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">Successful deploy</font>'));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        installPackage({ ...context, password: "pass" }, zipPath.replace(/\.zip$/, "")),
      ).resolves.toBe("Successful deploy");

      const request = fetchMock.mock.calls[1];
      const init = request?.[1];
      expect(String(request?.[0])).toBe("http://192.0.2.1/plugin_install");
      expect(init?.method).toBe("POST");
      expect(readAuthorization(init)).toContain('Digest username="rokudev"');

      if (!(init?.body instanceof FormData)) {
        throw new Error("expected FormData request body");
      }

      const archive = init.body.get("archive");
      if (!(archive instanceof File)) {
        throw new Error("expected archive file");
      }

      expect(init.body.get("mysubmit")).toBe("Replace");
      expect(archive.name).toBe("channel.zip");
      expect(await archive.text()).toBe("zip");
      expect(timeoutSpy).toHaveBeenCalledWith(100);
      expect(timeoutSpy).toHaveBeenCalledWith(150_000);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats successful 200 install pages without legacy font markup as successful", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            "Shell.create('Roku.Message').trigger('setType', 'success').trigger('setMessage', 'Install Success.')",
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Successful deploy",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses the final success from multi-message installer pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response(`
            <font color="red">Application Received.</font>
            <font color="red">
              Install Success.
            </font>
          `),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Successful deploy",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses structured success when a progress font message appears first", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response(`
            <font color="red">Application Received.</font>
            Shell.create('Roku.Message').trigger('setType', 'success').trigger('setMessage', 'Install Success.')
          `),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Successful deploy",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats application-received installer pages as successful", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response('<font color="red">Application Received: 1079 bytes stored.</font>'),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Successful deploy",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unrecognized non-empty 200 install pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response("<html><title>Success</title></html>"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Unrecognized Roku installer response",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects empty 200 install responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response(""));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Empty Roku installer response",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects structured Roku installer error messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            "Shell.create('Roku.Message').trigger('show', 'error').trigger('text', 'Compile failed')",
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Compile failed",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects JSON payload Roku installer error messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            `JSON.parse('{"messages":[{"type":"error","text_type":"text","text":"Package rejected"}]}');`,
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Package rejected",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects Roku software-update install failure pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response("'Failed to check for software update'"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Failed to check for software update",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("falls back from Replace to Install when the developer slot is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">No plugin installed</font>'))
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce2"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">Install Success.</font>'));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Successful deploy",
      );

      const replaceBody = fetchMock.mock.calls[1]?.[1]?.body;
      const installBody = fetchMock.mock.calls[3]?.[1]?.body;
      if (!(replaceBody instanceof FormData) || !(installBody instanceof FormData)) {
        throw new Error("expected FormData request bodies");
      }

      expect(replaceBody.get("mysubmit")).toBe("Replace");
      expect(installBody.get("mysubmit")).toBe("Install");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects fallback Install responses that are not installer successes", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">No plugin installed</font>'))
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce2"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">Compile failed</font>'));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Compile failed",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not mask real Replace failures with an Install retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(new Response('<font color="red">Compile failed</font>'));
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).rejects.toThrow(
        "Compile failed",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats identical package installs as successful without fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-install-test-"));
    const zipPath = join(root, "channel.zip");

    try {
      await writeFile(zipPath, "zip");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("", {
            headers: {
              "WWW-Authenticate": 'Digest qop="auth", realm="rokudev", nonce="nonce"',
            },
            status: 401,
          }),
        )
        .mockResolvedValueOnce(
          new Response('<font color="red">Identical to previous version -- not replacing.</font>'),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(installPackage({ ...context, password: "pass" }, zipPath)).resolves.toBe(
        "Identical to previous version -- not replacing",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

const readAuthorization = (init: RequestInit | undefined): string => {
  const headers = init?.headers;
  if (headers === undefined || headers instanceof Headers || Array.isArray(headers)) {
    throw new Error("expected plain header record");
  }

  return headers.Authorization ?? "";
};
