<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72">
  </p>

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
pnpm exec rokit check
pnpm exec rokit launch dev
pnpm exec rokit press Down Select
pnpm exec rokit query /query/active-app
pnpm exec rokit wait-node videoPlayerScreen visible
pnpm exec rokit screenshot artifacts/live/player.png
```

## Commands

```bash
rokit check
rokit device-info
rokit active-app
rokit wait-active <app-id> [--timeout-ms <ms>]
rokit launch <app-id> [--param key=value]
rokit press <key> [key...]
rokit query <ecp-path>
rokit sgnodes
rokit assert-node <node-name> <visible|hidden|absent|text|attr> [value]
rokit wait-node <node-name> <visible|hidden|absent|text|attr> [value] [--timeout-ms <ms>]
rokit screenshot <output-path>
rokit install <zip-path>
rokit --version
```

- `check` confirms the Roku ECP endpoint responds and the developer installer
  is reachable.
- `device-info` prints enhanced Roku device metadata as JSON.
- `active-app` prints the foreground app.
- `wait-active` waits until the requested app is foregrounded.
- `launch` opens an app and waits until it is active. Use repeated `--param`
  values for deeplink parameters.
- `press` sends Roku remote keys through ECP.
- `query` prints a raw ECP response such as `/query/sgnodes/all`.
- `sgnodes` prints the raw SceneGraph tree from `/query/sgnodes/all`.
- `assert-node` checks a named SceneGraph node once.
- `wait-node` polls SceneGraph until a named node condition matches.
- `screenshot` saves a developer screenshot. It requires `ROKIT_PASSWORD`.
- `install` publishes an existing ZIP through `roku-deploy`. It requires
  `ROKIT_PASSWORD`.

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
- SceneGraph state queries and named-node assertions
- screenshots

App repositories should keep their own scenario commands for product behavior,
such as opening a specific route, asserting playback state, generating review
HTML, or checking app-specific UI nodes.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)

## License

[MIT](./LICENSE)
