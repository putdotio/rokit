# Agent Readiness

Status: current as of 2026-05-15

`rokit` is a CLI/package repo. There is no long-running app to boot; readiness is based on deterministic package verification plus optional live Roku proof.

## Grade

Overall: B-

| Dimension  | Status | Evidence                                                                                                                                     | Gap                                     |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| bootable   | pass   | `pnpm smoke` builds the CLI and checks `--version` plus `--help`                                                                             | no server boot surface, by design       |
| testable   | pass   | `pnpm verify` runs TypeScript, bundle, unit tests, and npm pack dry run                                                                      | live Roku checks require local hardware |
| observable | pass   | CLI commands print active app, device info, raw ECP state, SceneGraph XML, screenshots, compact assertion failures, and explicit JSON output | no automatic non-TTY JSON mode          |
| verifiable | pass   | CI runs `pnpm verify`; `pnpm live:smoke` proves a configured Roku responds                                                                   | no CI hardware lane                     |

## Layers

- Boot: `pnpm smoke`
- Smoke: `pnpm smoke`
- Interact: `rokit press`, `rokit launch`, `rokit query`, `rokit sgnodes`
- E2e: `pnpm live:smoke` for a configured developer-enabled Roku
- Enforce: GitHub Actions `verify`, optional `.git-hooks/pre-push`
- Observe: ECP responses, SceneGraph XML, screenshots, concise command output
- Isolate: `.rokit/` and `.env` stay local per worktree

## Setup For Agents

```bash
pnpm install
pnpm verify
```

Optional local hook:

```bash
pnpm hooks:install
```

Optional live smoke:

```bash
ROKIT_TARGET=<roku-ip> pnpm live:smoke
```
