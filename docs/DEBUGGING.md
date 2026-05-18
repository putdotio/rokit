# Roku Debugging

`rokit` can wrap Roku debugging surfaces when they expose generic device or
runtime state. Keep product journeys, selectors, content IDs, account state, and
assertions in consumer app repos.

## Official Surfaces

Roku documents the developer debug console as a telnet connection to port
`8085`. It emits app runtime output, compilation errors, crash line numbers,
stack traces, and variable state when an app fails. Open it before sideloading or
reproducing a startup crash so the first failure is captured.

Roku also documents debug-server utilities on port `8080`. Useful generic
commands include:

| Command             | Port   | Use                                         |
| ------------------- | ------ | ------------------------------------------- |
| `chanperf`          | `8080` | Current app memory and CPU snapshot         |
| `free`              | `8080` | Device memory snapshot                      |
| `sgnodes roots`     | `8080` | Top-level SceneGraph nodes                  |
| `sgnodes all`       | `8080` | Full SceneGraph node listing                |
| `sgnodes <node_ID>` | `8080` | SceneGraph nodes with a matching `id` field |
| `loaded_textures`   | `8080` | Loaded texture diagnostics                  |
| `r2d2_bitmaps`      | `8080` | Bitmap diagnostics                          |

The BrightScript debug protocol is a separate binary protocol for interactive
debugger clients. It can inspect variables, stack traces, breakpoints, and
stepping state after a launch request enables remote debugging. It is not the
first `rokit` target because crash capture needs append-only text artifacts more
than an IDE-style session.

Sources:

- [Roku debugging](https://developer.roku.com/docs/developer-program/debugging/debugging-channels.md)
- [BrightScript debug protocol](https://developer.roku.com/docs/developer-program/debugging/socket-based-debugger.md)
- [Roku developer tools](https://developer.roku.com/docs/developer-program/dev-tools/tools-overview.md)

## `rokit` Shape

The implemented first slice covers text telnet capture and allowlisted
debug-server commands:

- `rokit console <output-path> [--duration-ms <ms>]` captures port `8085`
  output to a timestamped local log.
- `rokit debug-command <command> [args...]` sends one allowlisted command to
  port `8080` or `8085` and prints the response.

`debug-command` is described as mutating for agent safety because some
allowlisted Roku commands can affect profiling/debugger state.

Roku's `chanperf -r <seconds>` command writes repeated samples to the
BrightScript console on `8085`, not the `8080` socket that receives the command.
`rokit debug-command` intentionally rejects that form until a coordinated
capture command can open the console, start sampling, stop sampling, and write
one proof bundle.

The natural next command is `rokit crash-watch <app-id> <output-dir>`, which
would connect to the console, launch an app, capture logs, and write normal
proof artifacts after the capture window.

Use Node's `node:net` module directly instead of shelling out to a local telnet
binary. This keeps the CLI cross-platform, typed, and easier to test.

## Limits

- Live verification requires a developer-enabled Roku with reachable debug
  ports. Unit tests can cover parsing, command validation, output paths, and
  socket behavior with fake TCP servers.
- The console should be connected before the repro. It cannot recover log lines
  emitted before the socket was open.
- Another tool, such as an IDE or Roku plugin, may already own the console
  connection.
- If the device hard-reboots, `rokit` can only preserve bytes received before
  the socket disconnects.
