# Agent Guide

`rokit` is a small Node CLI that wraps generic Roku device harness primitives.
Keep it platform-focused, typed, and useful for both humans and agents.

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
- Keep CLI wiring thin: parse/dispatch commands, then call named Roku helpers.
- Keep human output stable; `--json` / `--output json` should wrap every
  command result and error in a deterministic object for agents.
- Keep `src/index.ts` as the public library surface for app-specific scenario
  scripts. Export generic Roku/SceneGraph primitives only.
- Treat `process.cwd()` as the consumer app root.
- Keep `.rokit/` consumer-local; it can hold env, generated artifacts, and
  transient device state.
- Wrap `roku-deploy` for package publish, screenshots, and device metadata when
  it already owns the platform mechanics.
- Use Roku ECP for launch, keypresses, active-app queries, and raw runtime
  state.
- Media-player helpers can parse and wait on Roku `/query/media-player` state,
  but app repos own expectations about specific content, playback URLs, and
  containers.
- Keep SceneGraph helpers generic: node state, text, attributes, focus/state
  waits, and raw tree output are okay; product-specific screen contracts stay in
  app repos.
- Keep app journeys, content IDs, account data, and product assertions out of
  the generic harness.

## Sharp Edges

- Missing config/env and child-command failures should not print stack traces.
- `ROKIT_PASSWORD` is required only for developer-installer operations such as
  install and screenshot.
- `ROKU_DEV_TARGET` and `ROKU_DEV_PASSWORD` are compatibility fallbacks, not the
  primary public contract.
- Avoid sleeps in generic commands. App repos can add meaningful wait/assert
  loops around `rokit` primitives.
- Release details live in `docs/DISTRIBUTION.md`; readiness details live in
  `docs/READINESS.md`.

## When Contracts Change

- Command, env, or output changes: update `README.md` and CLI tests.
- CI/release/publishing changes: update workflow docs or release config in the
  same change.
- Keep `CLAUDE.md` as a symlink to this file if Claude-compatible discovery is
  added.

## Checks

```bash
vp install
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
ROKIT_TARGET=<roku-ip> vp exec rokit check
ROKIT_TARGET=<roku-ip> vp exec rokit launch dev
ROKIT_TARGET=<roku-ip> vp exec rokit press Info Back
```
