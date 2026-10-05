# Distribution

`rokit` is a public npm package published as `@putdotio/rokit`.

## Continuous Release

Merges to `main` are considered publishable. The CI workflow runs:

1. `verify` on pull requests, `main` pushes, and manual dispatch.
2. semantic-release on `main` after `verify` passes.

semantic-release analyzes Conventional Commits; a releasable commit publishes to npm, creates a GitHub Release, and commits the released `package.json` version back to `main` with `[skip ci]`.

The release job calls the [shared frontend release workflow](https://github.com/putdotio/.github) from `putdotio/.github`, pinned to a reviewed commit SHA; the semantic-release action and plugin pins live there. The `verify` job ends with the shared [links](https://github.com/putdotio/.github#actionslinks) and [scan](https://github.com/putdotio/.github#actionsscan) actions from the same repository: an offline Markdown link and anchor check on every run, and an Actionlint and Zizmor audit when a `main` push changes workflows and on manual dispatch. GitHub secret scanning and push protection cover secrets in this public repository.

## Release Credentials

The release job uses the `release` GitHub Environment with `deployment: false`.

Required protected inputs:

- `PUTIO_CI_APP_CLIENT_ID` as a repository or Environment variable
- `PUTIO_CI_APP_PRIVATE_KEY` as an Environment secret

The npm package uses Trusted Publishing from GitHub Actions. On npm, configure owner `putdotio`, repository `rokit`, workflow `ci.yml`, and Environment named `release` for the package.

During the `@semantic-release/npm` publish step, npm detects the GitHub OIDC identity, mints short-lived publish credentials, and publishes provenance for the release job.

Release writes use the `putio-ci` installation token. The default `GITHUB_TOKEN` remains read-only, and the release bot token is minted only after dependencies are installed.

## Package Contents

`files` in [`package.json`](../package.json)
lists what the npm package ships. It carries the docs, consumer skill, and
generic live probe so agents consuming the package can inspect distribution
and Roku proof mechanics without cloning the repository. Packaged docs
link files outside the tarball by absolute GitHub URL.

The published dependencies pin Effect, platform-node, and platform-node-shared to
the same exact version. Keep those pins aligned: platform-node accepts any
compatible platform-node-shared, and a newer shared runtime can be incompatible
with the pinned Effect.

The build bundles pinned `jpeg-js` with the patch maintained under `patches/`
so ordinary npm consumers receive the same decoder. The patch
caps single-component decoding at the remaining MCU count so valid final partial
restart intervals decode, and makes strict decoding reject scans that end before
the declared MCUs are complete. Keep the decoder bundled: ordinary npm consumers do
not inherit pnpm patches. Remove the patch only when a pinned upstream release
passes the partial-interval and early-end-marker regressions and installed-package
proof. Bundled third-party notices are in [Third-Party Notices](THIRD-PARTY-NOTICES.md).

## Release Smoke

After a release, confirm the tag and package are visible:

```bash
gh release list --repo putdotio/rokit --limit 5
npm view @putdotio/rokit version
```

Releases do not need a Roku. Real-device checks stay local because they require a developer-enabled device:

```bash
ROKIT_TARGET=<roku-ip> pnpm live:smoke
```
