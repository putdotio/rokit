import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { buildDebugCommand, captureDebugConsole, runDebugCommand } from "../src/debug.js";
import type { RokuContext } from "../src/roku.js";

describe("Roku debug helpers", () => {
  it("validates and formats allowlisted debug-server commands", () => {
    const command = buildDebugCommand("chanperf", []);

    expect(command).toEqual({
      args: [],
      command: "chanperf",
      port: 8080,
      request: "chanperf\r\n",
    });
  });

  it("normalizes SceneGraph id-field debug commands to Roku syntax", () => {
    expect(buildDebugCommand("sgnodes", ["videoPlayerScreen"])).toMatchObject({
      args: ["videoPlayerScreen"],
      request: "sgnodes videoPlayerScreen\r\n",
    });
    expect(buildDebugCommand("sgnodes", ["id", "videoPlayerScreen"])).toMatchObject({
      args: ["videoPlayerScreen"],
      request: "sgnodes videoPlayerScreen\r\n",
    });
  });

  it("rejects unsupported or unsafe debug commands", () => {
    expect(() => buildDebugCommand("cont", [])).toThrow("Unsupported Roku debug command");
    expect(() => buildDebugCommand("chanperf", ["-r", "5"])).toThrow(
      "chanperf -r writes to the BrightScript console",
    );
    expect(() => buildDebugCommand("sgnodes", ["../all"])).toThrow(
      "sgnodes id contains unsupported characters",
    );
  });

  it("runs a debug command over a TCP socket", async () => {
    let received = "";
    await withTcpServer(
      (socket) => {
        socket.on("data", (chunk: Buffer) => {
          received = `${received}${chunk.toString("utf8")}`;
          socket.write("channel: mem=15156KiB,%cpu=7\n");
        });
      },
      async (port) => {
        const context = testContext({ debugServerPort: port });
        const command = buildDebugCommand("chanperf", []);
        const result = await runDebugCommand(context, command, 200, 10);

        expect(received).toBe("chanperf\r\n");
        expect(result).toMatchObject({
          body: "channel: mem=15156KiB,%cpu=7\n",
          command: "chanperf",
          port,
        });
        expect(result.bytes).toBeGreaterThan(0);
      },
    );
  });

  it("revalidates structural debug commands before socket writes", async () => {
    await withTcpServer(
      (socket) => {
        socket.on("data", () => {
          socket.write("ok\n");
        });
      },
      async (port) => {
        const context = testContext({ debugServerPort: port });
        const forgedCommand = {
          args: [],
          command: "cont",
          port: 8080,
          request: "chanperf\r\n",
        } as const;

        await expect(runDebugCommand(context, forgedCommand, 200, 10)).rejects.toThrow(
          "Unsupported Roku debug command",
        );
      },
    );
  });

  it("waits for first debug-command bytes before applying the idle timeout", async () => {
    await withTcpServer(
      (socket) => {
        socket.on("data", () => {
          setTimeout(() => {
            socket.write("delayed diagnostics\n");
          }, 40);
        });
      },
      async (port) => {
        const context = testContext({ debugServerPort: port });
        const command = buildDebugCommand("loaded_textures", []);
        const result = await runDebugCommand(context, command, 200, 10);

        expect(result.body).toBe("delayed diagnostics\n");
      },
    );
  });

  it("captures BrightScript console output for a bounded duration", async () => {
    await withTcpServer(
      (socket) => {
        socket.write("Syntax Error. pkg:/source/Main.brs(12)\n");
      },
      async (port) => {
        const context = testContext({ debugConsolePort: port });
        const result = await captureDebugConsole(context, 20);

        expect(result).toMatchObject({
          body: "Syntax Error. pkg:/source/Main.brs(12)\n",
          durationMs: 20,
          port,
        });
        expect(result.bytes).toBeGreaterThan(0);
      },
    );
  });

  it("preserves partial debug console output when the socket resets", async () => {
    await withTcpServer(
      (socket) => {
        socket.write("crash before reboot\n");
        setTimeout(() => {
          socket.resetAndDestroy();
        }, 5);
      },
      async (port) => {
        const context = testContext({ debugConsolePort: port });
        const result = await captureDebugConsole(context, 200);

        expect(result).toMatchObject({
          body: "crash before reboot\n",
          port,
        });
      },
    );
  });
});

const testContext = (
  ports: Pick<RokuContext, "debugConsolePort" | "debugServerPort">,
): RokuContext => ({
  ...ports,
  target: "127.0.0.1",
  timeoutMs: 200,
  username: "rokudev",
});

const withTcpServer = async (
  handleConnection: (socket: Socket) => void,
  run: (port: number) => Promise<void>,
): Promise<void> => {
  const server = createServer(handleConnection);
  const port = await listen(server);

  try {
    await run(port);
  } finally {
    await closeServer(server);
  }
};

const listen = async (server: ReturnType<typeof createServer>): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }

      resolve(address.port);
    });
  });

const closeServer = async (server: ReturnType<typeof createServer>): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
