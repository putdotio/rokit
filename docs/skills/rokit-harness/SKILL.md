---
name: rokit-harness
description: Use rokit as a generic Roku harness adapter for packaging, installing, launching, key input, ECP/SceneGraph/media-player observation, readiness waits, screenshots, and proof bundles.
---

# rokit Harness

Use this skill when a repo consumes `@putdotio/rokit` for Roku device harness
work. Keep `rokit` generic and put app journeys, product selectors, fixture
names, content IDs, account state, and product assertions in the consumer app
repo.

## Workflow

1. Run `rokit describe` to inspect the command surface instead of guessing
   flags or `--input-json` payload fields.
2. Use `--dry-run` before mutating commands such as `package`, `install`,
   `launch`, `press`, `screenshot`, or `proof`.
3. Prefer structured output. In automation, rely on the non-TTY JSON default or
   pass `--json` explicitly.
4. Use `--fields` to keep observations small when only a few values are needed.
5. Screenshot commands append a timestamp to the requested filename. Use the
   returned JSON `data.path` as the artifact path instead of assuming the input
   path was written.
6. For live proof, use `rokit snapshot` for a quick state read,
   `rokit proof <output-dir>` for review artifacts, or `pnpm live:probe` in the
   rokit repo for the full generic package/install/launch/input/proof probe.
7. Use `rokit wait-ready <app-id>` after launch when the app can race ECP or
   SceneGraph readiness.
8. Use `rokit press --until-node ...` for bounded navigation loops instead of
   arbitrary sleeps.

## Boundaries

- Device IPs, developer passwords, screenshots, packages, and proof bundles stay
  local or ignored.
- `rokit` can assert generic Roku and SceneGraph state. Consumer repos own
  product routes, screen names when product-specific, playback/content
  expectations, and review narratives.
- ECP query paths must be plain paths. Do not include query strings, fragments,
  traversal, backslashes, or encoded path segments.
- The local Effect source setup is skipped whenever `CI` is set. Do not make CI,
  install, pack, or publish flows depend on cloning `.repos/effect`.
