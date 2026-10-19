# Contributing

## Setup

```bash
pnpm install
pnpm exec vp run hooks:install
```

## Run Locally

Use the built CLI through the package scripts while developing:

```bash
pnpm exec vp run smoke
```

For live Roku checks, copy `.env.example` to `.env` or `.rokit/.env`, or set the
variables in your shell.

## Validation

```bash
pnpm exec vp run verify
```

CI runs the same command on pull requests and before release.

## Live Checks

Live checks require a developer-enabled Roku on the same network:

```bash
ROKIT_TARGET=<roku-ip> pnpm exec vp run live:smoke
ROKIT_TARGET=<roku-ip> node dist/rokit.mjs press Info Back
```

Screenshots and installs require `ROKIT_PASSWORD`.

Keep device IPs, passwords, signing keys, tokens, and account-specific app data
in your shell or the gitignored `.rokit/.env`.

## Pull Requests

- Keep changes focused.
- Add or update tests when command behavior, parsing, output, or public exports change.
- Keep app-specific journeys out of `rokit`; add those to the consuming app repo instead.

## Distribution

Release and publishing details live in [Distribution](./docs/distribution.md).
