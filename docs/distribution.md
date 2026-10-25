# Distribution

`rokit` ships to npm as `@putdotio/rokit`, plus a GitHub Release per version.

## Release

On `main`, after `verify` passes, the release job in
[`ci.yml`](https://github.com/putdotio/rokit/blob/main/.github/workflows/ci.yml)
runs the shared
[frontend release workflow](https://github.com/putdotio/.github) with the plugins in
[`.releaserc.json`](https://github.com/putdotio/rokit/blob/main/.releaserc.json).
The Conventional Commit type decides whether a merge publishes.

## Release Credentials

The release job runs in the `release` GitHub Environment and needs:

- `PUTIO_CI_APP_CLIENT_ID`: repository or Environment variable
- `PUTIO_CI_APP_PRIVATE_KEY`: Environment secret

npm publishes through Trusted Publishing with provenance. On npm, the package
trusts owner `putdotio`, repository `rokit`, workflow `ci.yml`, and Environment
`release`.

## Package Contents

`files` in [`package.json`](../package.json) lists what ships: the docs,
consumer skill, and generic live probe, so consumers can read them without
cloning. Packaged docs link files outside the tarball by absolute GitHub URL.

Keep `effect`, `@effect/platform-node`, and `@effect/platform-node-shared` on
the same exact version. platform-node accepts any compatible shared runtime,
and a newer one can break the pinned Effect.

The build bundles `jpeg-js` with the patch under `patches/`, because npm
consumers do not inherit pnpm patches. Remove the patch only when a pinned
upstream release passes the partial-interval and early-end-marker regressions
and installed-package proof. Notices: [Third-Party Notices](third-party-notices.md).

## Release Smoke

```bash
gh release list --repo putdotio/rokit --limit 5
npm view @putdotio/rokit version
```

Releases need no Roku.
