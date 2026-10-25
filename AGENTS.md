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
- Native code owns the developer installer, screenshots, device-info, and
  package ZIPs. `roku-deploy` stays only for `rokudeploy.json` file-rule
  compatibility in `package` until native glob parity replaces it.
- ECP drives launch, keypresses, active-app, and raw runtime state.
- Media-player and SceneGraph helpers stay generic: state, text, attributes,
  focus waits, raw trees. Content, playback, and screen contracts stay in app
  repos.
- Debug commands use `node:net` sockets, not a telnet binary, so they run
  cross-platform and test against fake TCP servers. The binary BrightScript
  debug protocol is out of scope; crash capture needs append-only text.
- No sleeps in generic commands; app repos add wait loops around primitives.
- CLI tests call in-process entry points (`mainEffect` from `src/cli.ts` or the
  command effects) so V8 coverage counts them. Spawn `dist/rokit.mjs` only to
  test the process boundary; `vite.config.ts` does not count
  those runs.

## Effect

This repository uses the Effect TypeScript library. The installed version's own
guide is `node_modules/effect/AGENTS.md`; consult it for the APIs the change
touches, and search `node_modules/effect/src` for anything it does not cover.

## When Contracts Change

- Command, env, or output: update [README.md](README.md), CLI tests, and
  [skills/rokit/](skills/rokit/SKILL.md) agent guardrails.
- CI, release, or publishing: update [docs/distribution.md](docs/distribution.md)
  in the same change.

## Checks

Vite+ is the pinned `vite-plus` devDependency, so run it as `pnpm exec vp`.
In a new worktree, run the setup commands; `.worktreeinclude` copies local env
files in.

```bash
pnpm install
pnpm exec vp run hooks:install
pnpm exec vp run verify
```

Fast loops: `check`, `typecheck`, `smoke`, and `test`, each as
`pnpm exec vp run <name>`.

Live checks need a developer-enabled Roku. The CLI reads `.rokit/.env`;
`live:probe` also reads `.env` and `.env.local`. See `.env.example`.

```bash
ROKIT_TARGET=<roku-ip> pnpm exec vp run live:smoke
ROKIT_TARGET=<roku-ip> ROKIT_PASSWORD=<password> pnpm exec vp run live:probe
ROKIT_TARGET=<roku-ip> node dist/rokit.mjs press Info Back
```

Which proof a change needs:

- Docs only: `pnpm exec vp run check`, plus `pnpm exec vp run skills:lint` for
  `skills/`; no device run.
- Source, command, env, output or export changes: `pnpm exec vp run verify`.
- Device-facing behavior: `verify`, then `live:smoke` (read-only) or
  `live:probe` (installs the generic probe channel).

## Delivery

Open a pull request. Release credentials and smoke checks:
[docs/distribution.md](docs/distribution.md).
