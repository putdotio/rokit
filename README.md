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

Needs the Node version in `engines.node` of [`package.json`](./package.json). In the consumer repo:

```bash
pnpm add -D @putdotio/rokit
```

Only the latest published version receives routine fixes.

## Quick Start

Set the target Roku in the consumer app repo, in your shell or a gitignored
`.rokit/.env`:

```bash
export ROKIT_TARGET=<roku-ip>
export ROKIT_PASSWORD=<developer-mode-password>
```

`install` and `screenshot` need `ROKIT_PASSWORD`. `ROKU_DEV_TARGET` and
`ROKU_DEV_PASSWORD` work as fallbacks when the `ROKIT_*` names are unset.

```bash
pnpm exec rokit check
pnpm exec rokit package artifacts/live/channel.zip
pnpm exec rokit install artifacts/live/channel.zip
pnpm exec rokit launch dev
pnpm exec rokit press Down Select
pnpm exec rokit console artifacts/live/console.log --duration-ms 30000
pnpm exec rokit proof artifacts/live/proof --screenshot
```

`rokit describe` prints every command, parameter, and JSON payload field;
`rokit describe <command>` prints one.

## Automation

```bash
pnpm exec rokit --json active-app
pnpm exec rokit --dry-run launch dev
pnpm exec rokit --fields status,data.state media-player
pnpm exec rokit --input-json '{"command":"press","keys":["Down","Select"]}'
pnpm exec rokit --input-json @artifacts/rokit-payload.json
printf '{"command":"press","keys":["Back"]}' | pnpm exec rokit --input-json -
```

- Output is JSON when stdout is not a TTY, unless you pass `--output text`.
- `--input-json` also carries literal values that look like flags.
- Waits poll inside one timeout budget. On expiry they report the last
  completed observation and reject late success.
- Bounded navigation: `press Down --until-node videoPlayerScreen --until-state visible --max 8`.
- `--dry-run` validates a mutating command without touching the device or files.
- ECP paths reject query strings, fragments, traversal, backslashes, control
  characters, and percent-encoded segments.
- Output paths must stay inside the current directory.
- Screenshots append a timestamp to the filename; read the written path from
  the result. Captures that fail decoding or exceed the limits in
  [`src/screenshot-image.ts`](https://github.com/putdotio/rokit/blob/main/src/screenshot-image.ts) retry, then fail.

## Library Use

App scenario scripts import the generic helpers that
[`src/index.ts`](https://github.com/putdotio/rokit/blob/main/src/index.ts) exports:

```ts
import { assertSceneGraphNode, pressKey, type RokuContext } from "@putdotio/rokit";

const target = process.env.ROKIT_TARGET;
if (!target) {
  throw new Error("ROKIT_TARGET is not set");
}

const context: RokuContext = { target, timeoutMs: 10_000, username: "rokudev" };

await pressKey(context, "Info");
await assertSceneGraphNode(context, "videoPlayerScreen", { state: "visible" });
```

## Boundaries

`rokit` owns generic Roku mechanics:

- package, install, launch, deeplink params, and remote keypresses
- raw ECP queries and parsed media-player state
- BrightScript console capture and allowlisted debug-server commands
- SceneGraph state queries and named-node assertions
- timestamped screenshots, snapshots, and proof artifacts

Consumer app repos own product behavior: specific routes, playback of real
content, app-specific UI nodes, and review artifacts.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Agent guide](./AGENTS.md)
- [Distribution](./docs/distribution.md)
- [rokit skill](./skills/rokit/SKILL.md)
- [Roku debugging](./skills/rokit/references/debugging.md)
- [Security](https://github.com/putdotio/.github/blob/main/SECURITY.md)

## License

[MIT](./LICENSE)
