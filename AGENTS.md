# Agent Guide

`rokit` is a small Node CLI that wraps generic Roku device harness primitives.
Keep it platform-focused, typed, and useful for both humans and agents.

## Start Here

- [README.md](README.md): install, command surface, env contract, quick start.
- [docs/DEBUGGING.md](docs/DEBUGGING.md): Roku debug surfaces, console
  capture, crash-proof workflow.
- [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md): release path, semantic-release
  wiring, credentials.
- [skills/rokit/](skills/rokit/): consumer skill and its command references.

## Ways To Hurt Yourself

- **Merging publishes.** A `feat`, `fix`, `perf` or breaking commit on `main`
  publishes `@putdotio/rokit` to npm, and a published version number can never
  be reused, so the commit type is the release decision.
- **Taking over someone's Roku.** A Roku holds one sideloaded developer app,
  and the target may be a TV someone is watching. `install` and `live:probe`
  replace that app; `launch` and `press` change what is on screen. `check`,
  `device-info`, `active-app` and the other reads leave it alone, and
  `--dry-run` validates a mutating command without side effects.

## Generic Tool Boundary

- Keep `rokit` free of put.io product behavior. Do not add put.io app IDs,
  deep links, content IDs, account data, credentials, journeys, UI node names,
  or product assertions.
- `@putdotio/rokit`, `putdotio/rokit`, release-bot wiring, copyright, and
  security contacts are ownership/publishing metadata only; do not treat them
  as permission to add product-specific fixtures.
- Use neutral examples such as `dev`, `Example Channel`, `videoPlayerScreen`,
  and synthetic SceneGraph/XML data when docs or tests need sample app data.
- Consumer app repos own product scenario scripts, app-specific selectors,
  playback/content assertions, and review artifacts.

## Patterns

- Use Effect at the runtime boundary and for reusable effectful operations. Keep
  errors schema-backed and render them without stack traces in CLI output.
- Use `effect/cli` `Argument` and `Flag` primitives for command
  grammar before adding custom argv parsing.
- Keep CLI wiring thin: parse/dispatch commands, then call named Roku helpers.
- Keep `src/roku.ts` as a public compatibility barrel. Put implementation in
  focused modules such as `app-control`, `device`, `media-player-query`,
  `scenegraph-query`, and `roku-context`.
- Keep human output stable; `--json` / `--output json` should wrap every
  command result and error in a deterministic object for agents.
- Keep `src/index.ts` as the public library surface for app-specific scenario
  scripts. Export generic Roku/SceneGraph primitives only.
- Treat `process.cwd()` as the consumer app root.
- Keep `.rokit/` consumer-local; it can hold env, generated artifacts, and
  transient device state.
- Keep `skills/rokit/SKILL.md` aligned with agent-facing command and safety
  guardrails.
- Keep `examples/live-probe-channel` generic. It exists only to prove package,
  install, launch, input, SceneGraph, screenshot, and proof mechanics.
- Use native developer-installer, screenshot, device-info, and package-ZIP
  helpers where rokit owns the platform mechanics. Keep `roku-deploy` only for
  package-command compatibility with existing `rokudeploy.json` file rules until
  native glob parity replaces that adapter.
- Use Roku ECP for launch, keypresses, active-app queries, and raw runtime
  state.
- Media-player helpers can parse and wait on Roku `/query/media-player` state,
  but app repos own expectations about specific content, playback URLs, and
  containers.
- Keep SceneGraph helpers generic: node state, text, attributes, focus/state
  waits, and raw tree output are okay; product-specific screen contracts stay in
  app repos.

## Effect

This repository uses the Effect TypeScript library. The installed version's own
guide is `node_modules/effect/AGENTS.md`; consult it for the APIs the change
touches, and search `node_modules/effect/src` for anything it does not cover.

## Sharp Edges

- Missing config/env and child-command failures should not print stack traces.
- CLI tests default to in-process entry points (`mainEffect` from `src/cli.ts`
  or the command effects) so V8 coverage attributes them. Spawn
  `dist/rokit.mjs` only when the process boundary itself is under test; those
  runs are not attributed to coverage (see `vite.config.ts`).
- `ROKU_DEV_TARGET` and `ROKU_DEV_PASSWORD` are optional fallback aliases, not
  the primary public contract; the env contract is in [README.md](README.md#quick-start).
- Avoid sleeps in generic commands. App repos can add meaningful wait/assert
  loops around `rokit` primitives.

## When Contracts Change

- Command, env, or output changes: update `README.md` and CLI tests.
- CI/release/publishing changes: update workflow docs or release config in the
  same change.
- `CLAUDE.md` is a symlink to this file; keep it pointing here.

## Worktrees

`.worktreeinclude` carries local env files into managed worktrees. Run the
[Checks](#checks) setup commands. If device config is missing, copy
`.env.example` to `.env` or `.rokit/.env`.

## Checks

```bash
vp install
vp run hooks:install
vp run verify
```

Fast loops:

```bash
vp run check
vp run typecheck
vp run smoke
vp run test
```

Live Roku checks when a developer-enabled device exists:

```bash
ROKIT_TARGET=<roku-ip> vp run live:smoke
ROKIT_TARGET=<roku-ip> ROKIT_PASSWORD=<password> vp run live:probe
ROKIT_TARGET=<roku-ip> vp exec rokit check
ROKIT_TARGET=<roku-ip> vp exec rokit launch dev
ROKIT_TARGET=<roku-ip> vp exec rokit press Info Back
```

Which proof a change needs:

- Docs only: `vp run check`, plus `vp run skills:lint` for `skills/`; no
  device run.
- Source, command, env, output or export changes: `vp run verify`.
- Device-facing behavior: `verify`, then `live:smoke` (read-only) or
  `live:probe` (installs the generic probe channel).

## Delivery

Open a pull request; CI runs `vp run verify` on pull requests and on `main`.
On `main`, semantic-release publishes releasable commits to npm and GitHub
Releases. Credentials and release smoke: [Distribution](docs/DISTRIBUTION.md).
