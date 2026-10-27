# Agent Guide

`rokit` is a Node CLI and library of generic Roku device harness primitives,
for humans and agents.

## Ways To Hurt Yourself

- **Merging publishes.** A `feat`, `fix`, `perf`, revert or breaking commit on
  `main` publishes `@putdotio/rokit` to npm, and a published version number can
  never be reused, so the commit type is the release decision.
- **Taking over someone's Roku.** A Roku holds one sideloaded developer app,
  and the target may be a TV someone is watching. `install` and `live:probe`
  replace that app; `launch` and `press` change what is on screen. `check`,
  `device-info`, `active-app` and the other reads leave it alone, and
  `--dry-run` validates a mutating command without side effects.

## Generic Tool Boundary

- Keep put.io product behavior out: no put.io app IDs, deep links, content IDs,
  account data, credentials, journeys, UI node names, or product assertions.
  Consumer app repos own those.
- The `@putdotio` scope, release wiring, copyright, and security contacts are
  ownership metadata, not permission to add product fixtures.
- Sample data uses neutral names such as `dev`, `Example Channel`,
  `videoPlayerScreen`, and synthetic SceneGraph XML.
- `examples/live-probe-channel` stays generic. It only proves package, install,
  launch, input, SceneGraph, screenshot, and proof mechanics.

## Patterns

- Effect at the runtime boundary and for reusable effectful operations. Errors
  are schema-backed and render without stack traces.
- `effect/cli` `Argument` and `Flag` for command grammar before custom argv
  parsing. CLI wiring only parses and dispatches to named Roku helpers.
- `src/roku.ts` is a compatibility barrel; implementation goes in focused
  modules. `src/index.ts` is the public library surface and exports generic
  primitives only.
- Human output stays stable. `--json` / `--output json` wraps every result and
  error in a deterministic object.
- `process.cwd()` is the consumer app root; `.rokit/` there holds its env file,
  artifacts, and transient device state.
- Native code owns the developer installer, screenshots, and package ZIPs.
  `roku-deploy` stays for `device-info` and for `rokudeploy.json` file-rule
  compatibility in `package` until native glob parity replaces it.
- Media-player and SceneGraph helpers stay generic: state, text, attributes,
  focus waits, raw trees. Content, playback, and screen contracts stay in app
  repos.
- Debug commands use `node:net` sockets, not a telnet binary, so they run
  cross-platform and test against fake TCP servers. The binary BrightScript
  debug protocol is out of scope; crash capture needs append-only text.
- No sleeps in generic commands; app repos add wait loops around primitives.

## Effect

This repository uses the Effect TypeScript library. The installed version's own
guide is `node_modules/effect/AGENTS.md`; consult it for the APIs the change
touches, and search `node_modules/effect/src` for anything it does not cover.

## When Contracts Change

- Command, env, or output: update [README.md](README.md), CLI tests, and
  [skills/rokit/](skills/rokit/SKILL.md) agent guardrails.

## Checks

Vite+ is the pinned `vite-plus` devDependency, so run it as `pnpm exec vp`.
Setup, validation, and live checks: [CONTRIBUTING](CONTRIBUTING.md).

Which proof a change needs:

- Docs only: `pnpm exec vp run check`, plus `pnpm exec vp run skills:lint` for
  `skills/`; no device run.
- Source, command, env, output or export changes: `pnpm exec vp run verify`.
- Device-facing behavior: `verify`, then `live:smoke` (read-only) or
  `live:probe` (installs the generic probe channel).

## Delivery

Open a pull request. Release rules no file enforces:

- npm Trusted Publishing for `@putdotio/rokit` must trust owner `putdotio`, repository `rokit`,
  workflow [`ci.yml`](https://github.com/putdotio/rokit/blob/main/.github/workflows/ci.yml), and Environment `release`.
  Renaming any of them breaks publishing until the npm setting matches.
- Keep `effect` and every `@effect/*` package in [`package.json`](package.json)
  on one exact version. A newer shared runtime can break the pinned Effect. The
  shared preset inherited by [`renovate.json`](renovate.json) moves them together.
- The build bundles `jpeg-js` with the patch in [`patches/`](https://github.com/putdotio/rokit/blob/main/patches),
  because npm consumers do not inherit pnpm patches. Drop it only when a pinned
  upstream release passes the partial-interval and early-end-marker
  regressions and installed-package proof. Keep
  [docs/third-party-notices.md](docs/third-party-notices.md) in step.
