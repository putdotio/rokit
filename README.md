<div align="center">
  <h1>rokit</h1>

  <p>A tiny CLI companion for Roku device harness work.</p>

  <p>
    <a href="https://github.com/putdotio/rokit/actions/workflows/ci.yml?query=branch%3Amain" style="text-decoration:none;"><img src="https://img.shields.io/github/actions/workflow/status/putdotio/rokit/ci.yml?branch=main&style=flat&label=ci&colorA=000000&colorB=000000" alt="CI"></a>
    <a href="https://www.npmjs.com/package/@putdotio/rokit" style="text-decoration:none;"><img src="https://img.shields.io/npm/v/%40putdotio%2Frokit?style=flat&label=npm&logo=npm&colorA=000000&colorB=000000" alt="npm version"></a>
    <a href="https://github.com/putdotio/rokit/blob/main/LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/github/license/putdotio/rokit?style=flat&label=license&colorA=000000&colorB=000000" alt="License"></a>
  </p>
</div>

## Install

```bash
pnpm add -D @putdotio/rokit
```

`rokit` wraps Roku platform primitives for live-device proof loops. It does not
own app-specific journeys, content IDs, credentials, or product assertions.

## Usage

Create `.rokit/.env` or export environment variables in the app repo:

```bash
ROKIT_TARGET=<roku-ip>
ROKIT_PASSWORD=<developer-mode-password>
```

Then run:

```bash
pnpm exec rokit describe
pnpm exec rokit discover
pnpm exec rokit package --out artifacts/live/channel.zip
pnpm exec rokit check
pnpm exec rokit launch dev
pnpm exec rokit press Down Select
pnpm exec rokit press --delay-ms 250 --max 8 Down --until-node videoPlayerScreen visible
pnpm exec rokit press --delay-ms 250 Right Select
pnpm exec rokit query /query/active-app
pnpm exec rokit wait-node videoPlayerScreen visible
pnpm exec rokit wait-ready dev --media-state play
pnpm exec rokit snapshot
pnpm exec rokit proof artifacts/live/proof --screenshot
pnpm exec rokit screenshot artifacts/live/player.png
pnpm exec rokit --json active-app
```

App-specific scenario scripts can also import the generic helpers:

```ts
import {
  assertNamedNodeState,
  assertNamedNodeTranslation,
  assertMediaPlayerContainer,
  assertSceneGraphNode,
  pressKey,
  querySceneGraph,
  sceneGraphContainsText,
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
const xml = await querySceneGraph(context, { attempts: 3, requireComplete: true });
await assertSceneGraphNode(context, "videoPlayerScreen", { state: "visible" });
assertNamedNodeTranslation(xml, "videoPlayerScreen", 0, 0);
await assertMediaPlayerContainer(context, "mp4");
await waitForSceneGraphAssertion(context, "expected player", (xml) => {
  assertNamedNodeState(xml, "videoPlayerScreen", "visible");
  if (!sceneGraphContainsText(xml, "Ready")) {
    throw new Error("expected ready text");
  }
});
```

## Commands

```bash
rokit describe
rokit check
rokit discover [--timeout-ms <ms>]
rokit device-info
rokit active-app
rokit media-player
rokit snapshot
rokit proof <output-dir> [--screenshot]
rokit package --out <zip-path>
rokit wait-active <app-id> [--timeout-ms <ms>]
rokit wait-media-player <state> [--timeout-ms <ms>]
rokit wait-ready <app-id> [--media-state <state>] [--node <node-name> <condition> [value]] [--timeout-ms <ms>]
rokit launch <app-id> [--param key=value]
rokit press [--delay-ms <ms>] [--max <count>] <key> [key...] [--until-node <node-name> <condition> [value]]
rokit query <ecp-path>
rokit sgnodes
rokit assert-node <node-name> <visible|hidden|absent|text|attr> [value]
rokit wait-node <node-name> <visible|hidden|absent|text|attr> [value] [--timeout-ms <ms>]
rokit screenshot <output-path>
rokit install <zip-path>
rokit --version
```

Global options:

```bash
rokit --json <command>
rokit --output json <command>
rokit --dry-run <mutating-command>
rokit --fields status,data.state <command>
rokit --input-json '{"command":"press","keys":["Down","Select"]}'
```

JSON mode wraps command output as `{ "status": "ok", "command": "...", ... }`
and reports failures as `{ "status": "failed", "error": { "message": "..." } }`.
When stdout is not a TTY, command output defaults to JSON unless
`--output text` is explicit.

- `describe` prints the machine-readable command surface, per-command
  parameters, JSON payload fields, global options, and agent-DX feature flags.
- `check` confirms the Roku ECP endpoint responds and the developer installer
  is reachable.
- `discover` uses SSDP to find Roku ECP devices on the local network. It does
  not write discovered device facts into repo files.
- `device-info` prints enhanced Roku device metadata as JSON.
- `active-app` prints the foreground app.
- `media-player` prints parsed `/query/media-player` playback state, including
  state, container, position, duration, and format metadata.
- `snapshot` prints a compact state object with device, active-app,
  media-player, and SceneGraph status observations.
- `proof` writes reviewable local artifacts: summary JSON, active-app JSON,
  device-info JSON, media-player JSON, raw SceneGraph XML when available, and
  an optional screenshot.
- `package` creates a sideload ZIP from the current app root with `roku-deploy`.
- `wait-active` waits until the requested app is foregrounded and tolerates
  transient ECP read failures while polling.
- `wait-media-player` waits until `/query/media-player` reports a target state
  such as `play`, `pause`, or `buffer`.
- `wait-ready` waits for the requested app to be foregrounded, checks
  SceneGraph completeness on a best-effort basis, and can also wait for a
  media-player state or named SceneGraph node.
- `launch` opens an app and waits until it is active. Use repeated `--param`
  values for deeplink parameters. Roku launch responses can race app startup, so
  launch accepts transient timeout/fetch failures and then verifies foreground
  state.
- `press` sends Roku remote keys through ECP. Use `--delay-ms` for navigation
  sequences that need a stable gap between keys. Add `--until-node` and `--max`
  to repeat a key sequence until a generic SceneGraph condition matches.
- `query` prints a raw ECP response such as `/query/sgnodes/all`.
- `sgnodes` prints the raw SceneGraph tree from `/query/sgnodes/all`. Library
  callers can pass retry options to `querySceneGraph`; use
  `requireComplete: true` when a scenario needs to reject partial SceneGraph
  dumps that include `<All_Nodes>` but no root `<App>` node yet.
- `assert-node` checks a named SceneGraph node once.
- `wait-node` polls SceneGraph until a named node condition matches.
- `screenshot` saves a developer screenshot. It requires `ROKIT_PASSWORD`.
- `install` publishes an existing ZIP through `roku-deploy`. It requires
  `ROKIT_PASSWORD`.

Mutating commands support `--dry-run` so agents can validate parsed inputs
without changing device or filesystem state. ECP paths reject query strings,
fragments, traversal, backslashes, control characters, and percent-encoded path
segments. Generated output paths must stay within the current working directory.

## Environment

```bash
ROKIT_TARGET=<roku-ip>
ROKIT_PASSWORD=<developer-mode-password>
ROKIT_USERNAME=rokudev
ROKIT_TIMEOUT_MS=10000
```

`ROKU_DEV_TARGET` and `ROKU_DEV_PASSWORD` are accepted as fallbacks for app
repos that already use Roku dev naming.

Keep `.rokit/` local. Device IPs, Developer Mode passwords, signing keys, user
tokens, and app-specific media identifiers do not belong in git.

## Boundaries

`rokit` is the generic Roku harness layer:

- device info
- install/publish
- launch and deeplink parameters
- remote keypresses
- raw ECP queries
- parsed media-player state from `/query/media-player`
- media-player active-state and container assertions
- SceneGraph state queries and named-node assertions
- SceneGraph attribute, numeric geometry, bounds, and translation readers
- SceneGraph completeness and escaped-text helpers
- SceneGraph geometry assertions, status/failure readers, and custom assertion
  wait loops
- screenshots

App repositories should keep their own scenario commands for product behavior,
such as opening a specific route, asserting playback state, generating review
HTML, or checking app-specific UI nodes.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Agent readiness](./docs/READINESS.md)
- [Agent DX score](./docs/AGENT_DX.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)

## License

[MIT](./LICENSE)
