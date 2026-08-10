# Distribution

`rokit` is a public npm package published as `@putdotio/rokit`.

## Local Contract

The release path starts with the repo-local verification command:

```bash
pnpm verify
```

`verify` runs formatting/lint checks, TypeScript, package bundling, tests, and an npm pack dry run. GitHub Actions calls this same command before release.

## Continuous Release

Merges to `main` are considered publishable. The CI workflow runs:

1. `verify` on pull requests and `main` pushes.
2. semantic-release on `main` after `verify` passes.

semantic-release analyzes conventional commits, publishes to npm, creates GitHub Releases, and writes release metadata when needed.

## Release Credentials

The release job uses the `release` GitHub Environment with `deployment: false`.

Required protected inputs:

- `PUTIO_RELEASE_BOT_CLIENT_ID` as a repository or Environment variable
- `PUTIO_RELEASE_BOT_PRIVATE_KEY` as an Environment secret

The npm package uses Trusted Publishing from GitHub Actions. On npm, configure owner `putdotio`, repository `rokit`, workflow `ci.yml`, and Environment named `release` for the package.

During the `@semantic-release/npm` publish step, npm detects the GitHub OIDC identity, mints short-lived publish credentials, and publishes provenance for the release job.

Release writes use the `putio-releaser` installation token. The default `GITHUB_TOKEN` remains read-only, and the release-bot remote is configured only after dependencies are installed.

## Package Contents

The npm package includes `dist`, `README.md`, `docs`, `examples`, `skills`,
`AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md`. The docs, consumer skill, and
generic live probe are included so agents consuming the package can inspect
distribution, security, and generic Roku proof mechanics without cloning extra
private context.

## Release Smoke

After a release, confirm the tag and package are visible:

```bash
gh release list --repo putdotio/rokit --limit 5
npm view @putdotio/rokit version
```

Live Roku behavior is not required for npm release. Real-device checks are local/manual because they require a developer-enabled Roku:

```bash
ROKIT_TARGET=<roku-ip> pnpm live:smoke
```
