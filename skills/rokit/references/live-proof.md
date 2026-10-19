# rokit Live Proof

Use this reference when the task needs Roku state, proof artifacts, screenshots,
SceneGraph assertions, or readiness waits.

## Discovery

Start with the runtime contract:

```bash
rokit describe
rokit describe proof
```

Use the one-command form when you already know the command family. When the
docs and `rokit describe` disagree, trust `describe`.

## Quick Reads

Use small read commands before proof bundles:

```bash
rokit --json snapshot --fields command,status,data.activeApp,data.mediaPlayer
rokit --json active-app
rokit --fields status,data.state media-player
rokit sgnodes
```

`--fields` trims JSON to the values you need.

## Mutating And Artifact Commands

Dry-run platform mutations before touching a device:

```bash
rokit --dry-run package artifacts/live/channel.zip
rokit --dry-run install artifacts/live/channel.zip
rokit --dry-run launch dev
rokit --dry-run press Down Select
```

For reviewable proof, use a dedicated output directory and read returned JSON
paths rather than assuming filenames:

```bash
rokit --json proof artifacts/live/proof --screenshot
```

## Readiness And Navigation

Use bounded waits instead of sleeps:

```bash
rokit wait-active dev --timeout-ms 10000
rokit wait-media-player play --timeout-ms 10000
rokit wait-ready dev videoPlayerScreen visible --media-state play --timeout-ms 15000
rokit press Down Select --until-node videoPlayerScreen --until-state visible --max 8
```
