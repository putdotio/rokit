---
name: rokit
description: Use when testing, sideloading, deploying, or debugging Roku apps with rokit, including package/install/launch flows, remote key input, BrightScript console capture, ECP/SceneGraph/media-player observation, screenshots, readiness waits, and proof bundles. Do not use for app-specific journeys, product selectors, fixture names, content IDs, account state, or product assertions — those live in the consumer app repo.
---

# rokit

Use this skill when a repo consumes `@putdotio/rokit` for Roku device harness
work. Keep `rokit` generic and put app journeys, product selectors, fixture
names, content IDs, account state, and product assertions in the consumer app
repo.

## Workflow

1. Run `rokit describe` to inspect the command surface instead of guessing
   flags or `--input-json` payload fields. Use `rokit describe <command>` when
   you only need one command schema.
2. Use `--dry-run` before mutating commands such as `package`, `install`,
   `launch`, `press`, `screenshot`, or `proof`.
3. Prefer structured output. In automation, rely on the non-TTY JSON default or
   pass `--json` explicitly.
4. Use `--fields` to keep observations small when only a few values are needed.
5. Screenshot commands append a timestamp to the requested filename. Use the
   returned JSON `data.path` as the artifact path instead of assuming the input
   path was written. Non-image responses and detected decoding errors fail
   capture. JPEG scan completion and restart order are checked before saving.
6. For live proof, use `rokit snapshot` for a quick state read,
   `rokit proof <output-dir>` for review artifacts, or `pnpm live:probe` in the
   rokit repo for the full generic package/install/launch/input/proof probe.
7. For crash/debug proof, start `rokit console <output-path>` before
   reproducing the problem so startup errors and crash traces are captured.
   Use `rokit debug-command <command>` only for generic Roku debug commands.
8. Use `rokit wait-ready <app-id> [node-name] [condition] [value]` after launch
   when the app can race ECP or SceneGraph readiness.
9. Use `rokit press <keys...> --until-node <node> --until-state visible` for
   bounded navigation loops instead of arbitrary sleeps.

## Start Here

Read only the reference needed for the current task:

- live proof, readiness waits, SceneGraph and media-player observation:
  [`references/live-proof.md`](references/live-proof.md)
- BrightScript console capture and debug-server commands:
  [`references/debugging.md`](references/debugging.md)

## Common Commands

```bash
rokit describe
rokit describe proof
rokit --json snapshot --fields command,status,data.activeApp,data.mediaPlayer
rokit --dry-run package artifacts/live/channel.zip
rokit --dry-run launch dev
rokit --json proof artifacts/live/proof --screenshot
rokit wait-node title text "Ready"
rokit --input-json '{"command":"press","keys":["Down","Select"]}'
rokit --input-json @artifacts/rokit-payload.json
printf '{"command":"press","keys":["Back"]}' | rokit --input-json -
rokit console artifacts/live/console.log --duration-ms 30000
```

## Boundaries

- Device IPs, developer passwords, screenshots, packages, and proof bundles stay
  local or ignored.
- `rokit` can assert generic Roku and SceneGraph state. Consumer repos own
  product routes, screen names when product-specific, playback/content
  expectations, and review narratives.
- ECP query paths must be plain paths. Do not include query strings, fragments,
  traversal, backslashes, or encoded path segments.
