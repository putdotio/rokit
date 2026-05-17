# Agent DX Score

Status: current as of 2026-05-17

`rokit` targets Roku harness work for humans and agents. The CLI is intentionally
generic: it wraps Roku device mechanics, state queries, packaging, input, and
proof artifacts without product journeys, account state, content IDs, or
put.io-specific assertions.

## Score

Overall: 16 / 21, Agent-first

| Axis                      | Score | Evidence                                                                                                                                                                                                                        | Remaining gap                                                            |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Machine-readable output   | 3     | `--json`, `--output json`, structured errors, and JSON default for non-TTY command output                                                                                                                                       | no paginated surfaces exist                                              |
| Raw payload input         | 2     | `--input-json` accepts typed payloads for every command                                                                                                                                                                         | payloads map to the CLI schema, not a live Roku API schema               |
| Schema introspection      | 2     | `rokit describe` returns command names, descriptions, target requirements, mutation flags, arguments/options, JSON payload fields, required fields, and agent-DX feature flags                                                  | schemas are static, not runtime-resolved from Roku firmware              |
| Context-window discipline | 2     | `--fields` filters structured output for all commands                                                                                                                                                                           | no streaming pagination because commands are single-observation surfaces |
| Input hardening           | 3     | ECP paths reject query strings, fragments, traversal, backslashes, control characters, and encoded path segments; generated output paths are sandboxed to the current app root; ECP path segments are encoded at the HTTP layer | none for the current command set                                         |
| Safety rails              | 2     | `--dry-run` validates mutating commands before device or filesystem side effects                                                                                                                                                | no response sanitization layer for device-returned strings               |
| Agent knowledge packaging | 2     | `AGENTS.md`, this scorecard, readiness docs, and `docs/skills/rokit-harness/SKILL.md` package agent-facing rules                                                                                                                | not a full versioned skill library                                       |

## Surface Coverage

- Existing read surfaces: `check`, `device-info`, `active-app`,
  `media-player`, `query`, `sgnodes`, `assert-node`, `wait-node`,
  `wait-active`, and `wait-media-player` all keep structured JSON output and
  compact failures.
- Existing write surfaces: `launch`, `press`, `screenshot`, and `install` now
  support `--dry-run` where it matters, and generated output paths stay inside
  the current app root.
- New proof surfaces: `snapshot` returns compact state, while `proof` writes a
  local review bundle with JSON observations, raw SceneGraph XML when available,
  and an optional screenshot.
- New setup surfaces: `describe` is target-free schema discovery, `discover`
  finds Roku ECP devices without writing local facts, and `package` creates a
  sideload ZIP from the current app root.
- New readiness surface: `wait-ready` composes foreground app checks with
  best-effort SceneGraph completeness and optional media-player or node waits.
- New interaction surface: `press --until-node` repeats a generic remote-key
  sequence until a SceneGraph condition matches.

## Agent Rules

- Expected CLI failures are schema-backed Effect errors. Render them with the
  repo error helpers instead of printing stack traces.
- Prefer `rokit describe` before inventing command syntax. It is the canonical
  machine-readable schema for flags and `--input-json` payloads.
- Prefer `--json` or the non-TTY JSON default for automation.
- Use `--fields` when only a few values are needed from a large observation.
- Use `--dry-run` before mutating device state or writing proof/package outputs.
- Keep product journeys and product assertions in the consumer app repo.
- Keep `.rokit/` and generated proof/package outputs local or ignored.
