# SPEC 005 — v1 release

> **Status:** `approved (owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
v1 must reach users through the VS Code Marketplace and Open VSX with correct licensing and credit.

## Goal
`v1.0.0` is published to both registries by CI after the owner approves the release run.

## Acceptance criterion (falsifiable)
1. `README.md` contains ADR-007's attribution text verbatim and a "Support the original author" link to the sponsor link given in the `svelte-jsoneditor` README (`pnpm check:readme`).
2. `vsce ls --no-dependencies` lists `LICENSE` and `THIRD_PARTY_LICENSES.md` and no `*.map` files.
3. The `release` workflow runs only on `v*` tags, uses the GitHub Environment `release` with the owner as required reviewer, and reads `VSCE_PAT` and `OVSX_PAT` from that environment.
4. After the run, `npx @vscode/vsce show <publisher>.<name> --json` reports version `1.0.0`, and `https://open-vsx.org/api/<namespace>/<name>` reports `version: "1.0.0"`.
5. Specs 001–004 are `done` and G1 passed.

## Scope
- **In:** README, CHANGELOG, icon, marketplace metadata, release workflow, first publish.
- **Out:** Chrome Web Store (020).

## Current evidence (D2 — path + lines / section)
- ADR-007. `AGENTS.md` rule 7 (publishing is owner-reserved).

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-002 | Name, publisher ID, namespace | T1, T3 | see ledger |
| UNK-016 | Minimum VS Code version (`engines.vscode`) | final value shipped in v1 | delegated; resolved: `^1.136.2` (PR #52) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved — UNK-002 resolved; UNK-016 resolved (delegated, PR #52)
- [x] Human approval recorded (G0); owner approves the release run (G2)
