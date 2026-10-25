# Contributing

## Setup

```bash
pnpm install
pnpm exec vp run hooks:install
```

## Run Locally

```bash
pnpm exec vp run smoke
```

## Validation

```bash
pnpm exec vp run verify
```

CI runs the same command on pull requests and on `main`.

## Live Checks

Live checks need a developer-enabled Roku on the same network. Screenshots and
installs also need `ROKIT_PASSWORD`.

```bash
ROKIT_TARGET=<roku-ip> pnpm exec vp run live:smoke
ROKIT_TARGET=<roku-ip> node dist/rokit.mjs press Info Back
```

Keep device IPs, passwords, and account data in your shell or a gitignored env
file. The CLI reads `.rokit/.env`; `live:probe` also reads `.env` and
`.env.local`. Start from `.env.example`.

## Pull Requests

- Keep changes focused.
- Add or update tests when command behavior, parsing, output, or public exports change.
- Keep app-specific journeys out of `rokit`; they belong in the consuming app repo.

Release and publishing: [Distribution](./docs/distribution.md).
