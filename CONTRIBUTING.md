# Contributing

## Setup

```bash
vp install
```

## Run Locally

Use the built CLI through the package scripts while developing:

```bash
vp run smoke
```

For live Roku checks, set local environment variables in your shell or
`.rokit/.env`.

## Validation

```bash
vp run verify
```

`verify` runs static checks, TypeScript, packaging, tests, and an npm pack dry
run.

## Live Checks

Live checks require a developer-enabled Roku on the same network:

```bash
ROKIT_TARGET=<roku-ip> vp run live:smoke
ROKIT_TARGET=<roku-ip> vp exec rokit press Info Back
```

Screenshots and installs require `ROKIT_PASSWORD`.

Keep local device details in `.rokit/.env` or your shell. Do not commit device
IPs, passwords, signing keys, tokens, or account-specific app data.

## Pull Requests

- Keep changes focused.
- Add or update tests when command behavior, parsing, output, or public exports change.
- Include the most useful verification evidence for the change.
- Keep app-specific journeys out of `rokit`; add those to the consuming app repo instead.

## Distribution

Release and publishing details live in [Distribution](./docs/DISTRIBUTION.md).
