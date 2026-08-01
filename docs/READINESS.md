# Agent Readiness

Status: current as of 2026-05-28

`rokit` is a CLI/package repo. There is no long-running app to boot; readiness is based on deterministic package verification plus optional live Roku proof.

## Grade

Overall: B+

| Dimension  | Status | Evidence                                                                                                                                                                                                                                 | Gap                                     |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| bootable   | pass   | `pnpm smoke` builds the CLI and checks `--version` plus `--help`                                                                                                                                                                         | no server boot surface, by design       |
| testable   | pass   | `pnpm verify` runs TypeScript, bundle, unit tests, and npm pack dry run                                                                                                                                                                  | live Roku checks require local hardware |
| observable | pass   | CLI commands print active app, device info, raw ECP state, SceneGraph XML, BrightScript console logs, debug-server output, snapshots, proof bundles, screenshots, compact assertion failures, and JSON output by default in non-TTY runs | no CI hardware lane                     |
| verifiable | pass   | CI runs `pnpm verify`; `pnpm live:smoke` proves a configured Roku responds; `pnpm live:probe` packages, installs, launches, drives, asserts, screenshots, and proofs a generic channel                                                   | no CI hardware lane                     |

## Layers

- Boot: `pnpm smoke`, `rokit describe`
- Smoke: `pnpm smoke`, `rokit check`
- Interact: `rokit press`, `rokit launch`, `rokit query`, `rokit sgnodes`
- E2e: `pnpm live:probe` for a configured developer-enabled Roku
- Enforce: GitHub Actions `verify`, optional `.git-hooks/pre-push`
- Observe: ECP responses, SceneGraph XML, `rokit console`, `rokit debug-command`, `rokit snapshot`, `rokit proof`, screenshots, concise command output
- Isolate: `.rokit/` and `.env` stay local per worktree

## Agent-Facing CLI Contract

- The CLI entrypoint runs through Effect's Node runtime, and expected CLI
  failures are schema-backed errors rendered without stack traces.
- `rokit describe` exposes the machine-readable command surface, parameters,
  JSON payload fields, and global options without a Roku target. `rokit
describe <command>` returns one command schema for context-window control.
- Non-TTY command output defaults to JSON. Use `--output text` when a human
  transcript is required.
- `--input-json` lets agents provide typed command payloads inline, from a file
  with `@path`, or from stdin with `-` without translating everything into
  flags.
- `--fields` trims JSON output for context-window control.
- `--dry-run` validates mutating commands without touching a device or writing
  files.
- ECP paths and generated output paths are hardened against common agent
  mistakes: query strings, fragments, traversal, backslashes, control
  characters, encoded path segments, and writes outside the current app root.

## Agent DX Score

Current score: 16/21, agent-first lower bound.

| Axis                    | Score | Evidence                                           | Gap                            |
| ----------------------- | ----- | -------------------------------------------------- | ------------------------------ |
| machine output          | 2     | consistent JSON output and structured JSON errors  | no NDJSON streaming surface    |
| raw payload input       | 2     | `--input-json` covers command payloads             | schemas are local, not API-gen |
| schema introspection    | 2     | `rokit describe` and `rokit describe <command>`    | not runtime-resolved from Roku |
| context discipline      | 2     | `--fields` trims JSON output everywhere            | no pagination surface          |
| input hardening         | 3     | hardened ECP paths and output-path sandboxing      | none known                     |
| safety rails            | 2     | mutating commands support `--dry-run`              | no response sanitization layer |
| agent knowledge package | 3     | `AGENTS.md` plus `skills/rokit/SKILL.md` ship cues | none known                     |

## Setup For Agents

```bash
pnpm install
pnpm hooks:install
pnpm verify
```

`pnpm install` runs the local Effect source setup outside CI only. When `CI` is
set to any non-empty value, `scripts/prepare-effect.sh` exits without cloning
`.repos/effect` so install, pack, publish, and CI/CD workspaces stay predictable.

Optional live smoke:

```bash
ROKIT_TARGET=<roku-ip> pnpm live:smoke
```

Full local live probe:

```bash
cp .env.example .env
# Fill ROKIT_TARGET and ROKIT_PASSWORD.
pnpm live:probe
```

`pnpm live:probe` reads `.env` and `.env.local`, accepts `ROKU_DEV_TARGET` and
`ROKU_DEV_PASSWORD` as fallbacks, copies `examples/live-probe-channel` into
`.rokit/live-probe/app`, packages it, installs it into the Roku developer slot,
launches `dev`, checks generic SceneGraph labels, sends `Info Back`, and writes
proof artifacts to `.rokit/live-probe/artifacts`.
