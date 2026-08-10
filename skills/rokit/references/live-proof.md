# rokit Live Proof

Use this reference when the task needs Roku state, proof artifacts, screenshots,
SceneGraph assertions, or readiness waits.

## Discovery

Start with the runtime contract:

```bash
rokit describe
rokit describe proof
```

Use `README.md` for the public command overview. Use the one-command form to
keep context small when you already know the command family. Use `src/cli.ts`
when command behavior and docs disagree.

## Quick Reads

Use small read commands before proof bundles:

```bash
rokit --json snapshot --fields command,status,data.activeApp,data.mediaPlayer
rokit --json active-app
rokit --fields status,data.state media-player
rokit sgnodes
```

`--fields` trims JSON for context control. Prefer it when only active app,
media-player, or proof paths matter.

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

Screenshot commands append timestamps to requested names. Use returned
`data.path` values as the artifact source of truth.

## Readiness And Navigation

Avoid arbitrary sleeps. Use bounded waits:

```bash
rokit wait-active dev --timeout-ms 10000
rokit wait-media-player play --timeout-ms 10000
rokit wait-ready dev videoPlayerScreen visible --media-state play --timeout-ms 15000
rokit press Down Select --until-node videoPlayerScreen --until-state visible --max 8
```

Rokit can assert generic ECP, media-player, and SceneGraph state. Consumer repos
own product routes, screen contracts, content expectations, and review text.
