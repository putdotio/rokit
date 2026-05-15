# Contributing

## Setup

```bash
vp install
```

## Verify

```bash
vp run verify
```

`verify` runs static checks, TypeScript, packaging, tests, and an npm pack dry
run.

## Live Checks

Live checks require a developer-enabled Roku on the same network:

```bash
ROKIT_TARGET=<roku-ip> vp exec rokit check
ROKIT_TARGET=<roku-ip> vp exec rokit launch dev
ROKIT_TARGET=<roku-ip> vp exec rokit press Info Back
```

Screenshots and installs require `ROKIT_PASSWORD`.

Keep local device details in `.rokit/.env` or your shell. Do not commit device
IPs, passwords, signing keys, tokens, or account-specific app data.
