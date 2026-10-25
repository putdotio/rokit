---
name: rokit
description: Drive Roku devices with rokit when testing, sideloading, or debugging Roku apps: package/install/launch, remote keys, BrightScript console capture, ECP/SceneGraph/media-player reads, screenshots, readiness waits, and proof bundles. App-specific journeys, selectors, content IDs, and product assertions live in the consumer app repo.
---

# rokit

## Workflow

1. Run `rokit describe` (or `rokit describe <command>`) for flags and
   `--input-json` fields instead of guessing. When docs and `describe`
   disagree, trust `describe`.
2. Dry-run mutating commands such as `package`, `install`, `launch`, `press`,
   `screenshot`, or `proof` before touching a device.
3. Trim JSON output with `--fields`.
4. Read artifact paths from the returned JSON. Screenshots append a timestamp
   to the requested filename.
5. For state, use `rokit snapshot`; for review artifacts, `rokit proof
   <output-dir>`.
6. After launch, use `wait-ready` when the app can race ECP or SceneGraph
   readiness. Navigate with `press --until-node`, never arbitrary sleeps.
7. For crashes, start `rokit console` before you reproduce. See
   [`references/debugging.md`](references/debugging.md) for console capture
   and debug-server commands.

## Common Commands

```bash
rokit describe proof
rokit --json snapshot --fields command,status,data.activeApp,data.mediaPlayer
rokit --fields status,data.state media-player
rokit --dry-run install artifacts/live/channel.zip
rokit --json proof artifacts/live/proof --screenshot
rokit wait-active dev --timeout-ms 10000
rokit wait-ready dev videoPlayerScreen visible --media-state play --timeout-ms 15000
rokit wait-node title text "Ready"
rokit press Down Select --until-node videoPlayerScreen --until-state visible --max 8
printf '{"command":"press","keys":["Back"]}' | rokit --input-json -
```

## Boundaries

Device IPs, developer passwords, screenshots, packages, and proof bundles stay
local or ignored.
