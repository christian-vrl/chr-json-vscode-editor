# SPEC 001 — Repo foundation and CI guards

> **Status:** `approved (owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
No repository exists. Parallel agent threads need a shared repo whose CI enforces the project's
invariants (offline, license allowlist, golden masters, independent review) so that every gate is
machine-checkable and no human has to police them.

## Goal
On a clean checkout, the standard scripts (`AGENTS.md` §Canonical stack) build, test and package an
extension that installs and activates in VS Code, and CI blocks any PR that adds a network call, a
disallowed license, or lacks a Reviewer PASS for its head commit.

## Acceptance criterion (falsifiable)
1. CI on `main` is green and runs every standard script.
2. `pnpm package` writes `packages/vscode-extension/*.vsix`; `pnpm test:e2e` installs that file with
   `--install-extension` into a fresh VS Code and asserts the extension is active.
3. **Negative tests prove the guards:** a fixture calling `fetch('https://example.com')` makes
   `pnpm check:offline` exit non-zero; a fixture dependency licensed `GPL-3.0` makes
   `pnpm check:licenses` exit non-zero; `@fortawesome/free-solid-svg-icons` (`(CC-BY-4.0 AND MIT)`)
   passes. CI runs the fixtures as expected-failure jobs.
4. The `gate-review` check fails on a PR with no `Gate review …: PASS @ <head sha>` comment from a
   repo collaborator, and passes once one exists for the current head SHA.
5. `governance/VERSION` equals the kit's (1.2.0) and `AGENTS.md` contains no `<fill in` placeholder.

## Scope
- **In:** kit bootstrap, workspace skeleton, standard scripts, test harnesses, license, offline and gate-review checks, research snapshots, CI, branch protection.
- **Out:** editor features (002–004), publishing (005).

## Current evidence (D2 — path + lines / section)
- Kit flows: `docs/USAGE.md` Flow 1 and Flow 3. Kit source: project shared folder `sdd-starter-kit.zip`; filled files: shared folder `sdd/`.
- `@vscode/vsce` 4.0.0 requires `publisher` and prompts on a missing `repository` or LICENSE; it resolves dependencies through npm/yarn only, so with pnpm and a bundled extension, package with `--no-dependencies` (reviewer report, 2026-10-08, citing `validation.js:46-48`, `package.js:415-418, 806-810`, `npm.js:78`).
- Branch protection on private repos needs a paid GitHub plan (UNK-001).

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-001 | Remote and visibility | T0 | see ledger |
| UNK-002 | Name / publisher ID | T2 | see ledger |
| UNK-003 | License | T1 | see ledger |
| UNK-016 | Minimum VS Code version | final value of T2 `engines.vscode` | delegated; resolved: `^1.136.2` (PR #52) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved (UNK-001, 002, 003)
- [x] Human approval recorded (G0)
