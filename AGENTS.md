# Agent Guide

`rokit` is a small Node CLI that wraps generic Roku device harness primitives.
Keep it platform-focused, typed, and useful for both humans and agents.

## Patterns

- Keep CLI wiring thin: parse/dispatch commands, then call named Roku helpers.
- Treat `process.cwd()` as the consumer app root.
- Keep `.rokit/` consumer-local; it can hold env, generated artifacts, and
  transient device state.
- Wrap `roku-deploy` for package publish, screenshots, and device metadata when
  it already owns the platform mechanics.
- Use Roku ECP for launch, keypresses, active-app queries, and raw runtime
  state.
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
ROKIT_TARGET=<roku-ip> vp exec rokit check
ROKIT_TARGET=<roku-ip> vp exec rokit launch dev
ROKIT_TARGET=<roku-ip> vp exec rokit press Info Back
```
