<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72" alt="put.io Boncuk logo">
  </p>

  <h1>rokit</h1>

  <p>Roku device harness primitives for package, launch, input, state, and proof loops.</p>
  <p>Generic by design: app journeys, credentials, content IDs, and product assertions stay in consumer repos.</p>

  <p>
    <a href="https://github.com/putdotio/rokit/actions/workflows/ci.yml?query=branch%3Amain" style="text-decoration:none;"><img src="https://img.shields.io/github/actions/workflow/status/putdotio/rokit/ci.yml?branch=main&style=flat&label=ci&colorA=000000&colorB=000000" alt="CI"></a>
    <a href="https://www.npmjs.com/package/@putdotio/rokit" style="text-decoration:none;"><img src="https://img.shields.io/npm/v/%40putdotio%2Frokit?style=flat&label=npm&logo=npm&colorA=000000&colorB=000000" alt="npm version"></a>
    <a href="https://github.com/putdotio/rokit/blob/main/LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/github/license/putdotio/rokit?style=flat&label=license&colorA=000000&colorB=000000" alt="License"></a>
  </p>
</div>

## Install

Requires Node `>=24.19.0`; install it in a consumer repo with:

```bash
pnpm add -D @putdotio/rokit
```

## Quick Start

Set the target Roku in the app repo that consumes `rokit`:

```bash
export ROKIT_TARGET=<roku-ip>
export ROKIT_PASSWORD=<developer-mode-password>
```

Then run the generic device checks and actions you need:

```bash
pnpm exec rokit check
pnpm exec rokit package artifacts/live/channel.zip
pnpm exec rokit install artifacts/live/channel.zip
pnpm exec rokit launch dev
pnpm exec rokit press Down Select
pnpm exec rokit console artifacts/live/console.log --duration-ms 30000
pnpm exec rokit proof artifacts/live/proof --screenshot
```

`ROKIT_PASSWORD` is required for developer-installer operations such as
`install` and `screenshot`. `ROKU_DEV_TARGET` and `ROKU_DEV_PASSWORD` are
accepted as optional aliases when the `ROKIT_*` names are unset.

## Automation

Prefer JSON when `rokit` feeds another tool:

```bash
pnpm exec rokit describe
pnpm exec rokit describe proof
pnpm exec rokit --json active-app
pnpm exec rokit --dry-run launch dev
pnpm exec rokit --fields status,data.state media-player
pnpm exec rokit --input-json '{"command":"press","keys":["Down","Select"]}'
pnpm exec rokit --input-json @artifacts/rokit-payload.json
printf '{"command":"press","keys":["Back"]}' | pnpm exec rokit --input-json -
```

`describe` prints the machine-readable command surface, including command
names, parameters, JSON payload fields, global options, and automation feature
flags. Pass a command name, such as `rokit describe proof`, to return a
one-command schema when you only need a small payload. When stdout is not a TTY,
command output defaults to JSON unless `--output text` is explicit.
Use inline `--input-json` for small payloads, `--input-json @file` for larger
payloads, and `--input-json -` to read the payload from stdin.

## Command Surface

Common commands:

| Command                                            | Purpose                                            |
| -------------------------------------------------- | -------------------------------------------------- |
| `describe [command]`                               | Print command schemas for all commands or one      |
| `check`                                            | Confirm ECP and developer-installer reachability   |
| `discover`                                         | Find Roku ECP devices with SSDP                    |
| `device-info`                                      | Read Roku device metadata                          |
| `active-app`                                       | Read the foreground app                            |
| `console <output-path>`                            | Capture BrightScript console output from `8085`    |
| `debug-command <command> [args...]`                | Run an allowlisted Roku debug command              |
| `media-player`                                     | Read parsed `/query/media-player` state            |
| `snapshot`                                         | Read a compact state snapshot                      |
| `proof <output-dir>`                               | Write reviewable local proof artifacts             |
| `package <zip-path>`                               | Create a sideload ZIP from the current app root    |
| `install <zip-path>`                               | Publish an existing ZIP to the Roku developer slot |
| `launch <app-id>`                                  | Launch an app by id with optional params           |
| `press <key...>`                                   | Send Roku remote keys                              |
| `query <ecp-path>`                                 | Print a raw ECP response                           |
| `sgnodes`                                          | Print the raw SceneGraph tree                      |
| `assert-node` / `wait-node`                        | Check generic SceneGraph node state                |
| `wait-active` / `wait-media-player` / `wait-ready` | Poll generic runtime readiness                     |
| `screenshot <output-path>`                         | Save a timestamped developer screenshot            |

Node waits use positional node conditions, for example
`wait-ready dev videoPlayerScreen visible` and `wait-node title text "Ready"`.
Remote navigation keeps the keys as positional arguments and uses options for
the bounded loop: `press Down --until-node videoPlayerScreen --until-state visible --max 8`.
Use `--input-json` for literal values that look like flags.

Mutating commands support `--dry-run` where the platform can validate without
changing device or filesystem state. ECP paths reject query strings, fragments,
traversal, backslashes, control characters, and percent-encoded path segments.
Generated output paths must stay within the current working directory.
Screenshots append a timestamp to the requested filename and report the actual
path written, so repeated captures do not reuse cache-prone filenames.

## Library Use

App-specific scenario scripts can import the generic helpers:

```ts
import {
  assertMediaPlayerContainer,
  assertSceneGraphNode,
  captureScreenshot,
  createPackageZip,
  deleteInstalledChannel,
  pressKey,
  querySceneGraph,
  waitForSceneGraphAssertion,
  type RokuContext,
} from "@putdotio/rokit";

const target = process.env.ROKIT_TARGET;
if (!target) {
  throw new Error("ROKIT_TARGET is not set");
}

const context: RokuContext = {
  target,
  timeoutMs: 10_000,
  username: "rokudev",
};

await pressKey(context, "Info");
await querySceneGraph(context, { attempts: 3, requireAppNode: true, requireComplete: true });
await assertSceneGraphNode(context, "videoPlayerScreen", { state: "visible" });
await assertMediaPlayerContainer(context, "mp4");
await captureScreenshot(
  { ...context, password: process.env.ROKIT_PASSWORD ?? "" },
  "artifacts/player.jpg",
  { attempts: 3 },
);
await waitForSceneGraphAssertion(context, "player ready", (xml) => {
  if (!xml.includes("videoPlayerScreen")) {
    throw new Error("expected player screen");
  }
});

await createPackageZip({
  rootDir: process.cwd(),
  outFile: "artifacts/channel.zip",
  exclude: (path) => path.startsWith("components/lab/"),
  overrides: [{ path: "manifest", contents: "title=Example Channel\n" }],
});
await deleteInstalledChannel({ ...context, password: process.env.ROKIT_PASSWORD ?? "" });
```

## Boundaries

`rokit` owns generic Roku mechanics:

- package, install, launch, deeplink params, and remote keypresses
- raw ECP queries and parsed media-player state
- BrightScript console capture and allowlisted debug-server commands
- SceneGraph state queries and named-node assertions
- timestamped screenshots, snapshots, and proof artifacts

Consumer app repos own product behavior: opening specific routes, asserting
playback for real content, checking app-specific UI nodes, and generating review
artifacts.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Roku debugging](./docs/DEBUGGING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [rokit skill](./skills/rokit/SKILL.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)

## License

[MIT](./LICENSE)
