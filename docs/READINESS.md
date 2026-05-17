# Agent Readiness

Status: current as of 2026-05-17

`rokit` is a CLI/package repo. There is no long-running app to boot; readiness is based on deterministic package verification plus optional live Roku proof.

## Grade

Overall: B+

| Dimension  | Status | Evidence                                                                                                                                                                                 | Gap                                     |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| bootable   | pass   | `pnpm smoke` builds the CLI and checks `--version` plus `--help`                                                                                                                         | no server boot surface, by design       |
| testable   | pass   | `pnpm verify` runs TypeScript, bundle, unit tests, and npm pack dry run                                                                                                                  | live Roku checks require local hardware |
| observable | pass   | CLI commands print active app, device info, raw ECP state, SceneGraph XML, snapshots, proof bundles, screenshots, compact assertion failures, and JSON output by default in non-TTY runs | no CI hardware lane                     |
| verifiable | pass   | CI runs `pnpm verify`; `pnpm live:smoke` proves a configured Roku responds; `rokit proof` collects review artifacts for live runs                                                        | no CI hardware lane                     |

## Layers

- Boot: `pnpm smoke`, `rokit describe`
- Smoke: `pnpm smoke`, `rokit check`
- Interact: `rokit press`, `rokit launch`, `rokit query`, `rokit sgnodes`
- E2e: `pnpm live:smoke` and `rokit proof <output-dir>` for a configured developer-enabled Roku
- Enforce: GitHub Actions `verify`, optional `.git-hooks/pre-push`
- Observe: ECP responses, SceneGraph XML, `rokit snapshot`, `rokit proof`, screenshots, concise command output
- Isolate: `.rokit/` and `.env` stay local per worktree

## Agent-Facing CLI Contract

- The CLI entrypoint runs through Effect's Node runtime, and expected CLI
  failures are schema-backed errors rendered without stack traces.
- `rokit describe` exposes the machine-readable command surface, parameters,
  JSON payload fields, and global options without a Roku target.
- Non-TTY command output defaults to JSON. Use `--output text` when a human
  transcript is required.
- `--input-json` lets agents provide typed command payloads without translating
  everything into flags.
- `--fields` trims JSON output for context-window control.
- `--dry-run` validates mutating commands without touching a device or writing
  files.
- ECP paths and generated output paths are hardened against common agent
  mistakes: query strings, fragments, traversal, backslashes, control
  characters, encoded path segments, and writes outside the current app root.

## Setup For Agents

```bash
pnpm install
pnpm verify
```

`pnpm install` runs the local Effect source setup outside CI only. When `CI` is
set to any non-empty value, `scripts/prepare-effect.sh` exits without cloning
`.repos/effect` so install, pack, publish, and CI/CD workspaces stay predictable.

Optional local hook:

```bash
pnpm hooks:install
```

Optional live smoke:

```bash
ROKIT_TARGET=<roku-ip> pnpm live:smoke
```
