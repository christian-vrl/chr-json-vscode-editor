# PLAN 005 — v1 release

> Derives from spec `005`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Prepare everything publishable in PRs. The owner creates accounts and secrets. Publishing burns a
version number and cannot be undone (D4), so the release job waits on a GitHub Environment approval
that only the owner can give; a stray tag push cannot publish.

## Constraints / invariants
- Tokens only as `release` environment secrets, never in files.
- No overwrite without snapshot/backup (D4).

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Listing content | README, CHANGELOG, icon | criteria 1–2 |
| B | Release workflow | `release.yml` + PR dry-run job (`pnpm package`, `vsce ls`) | dry run green; criterion 3 by reading the workflow |
| C | Accounts + secrets | owner runbook below | owner confirms |
| D | Publish | tag `v1.0.0`, owner approves run | criterion 4 |

## Owner runbook (T3–T4)
- **Marketplace:** create a publisher at the Visual Studio Marketplace publisher management page with
  the ID from UNK-002; create an Azure DevOps personal access token with the Marketplace "Manage" scope.
- **Open VSX:** sign in at open-vsx.org with GitHub, link an Eclipse account and sign the Publisher
  Agreement, create an access token; the first publish run creates the namespace (`ovsx create-namespace`).
- Add both tokens as `VSCE_PAT` and `OVSX_PAT` in the repo's `release` environment.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 Name taken on Marketplace | check before G0 answer on UNK-002 |

## Definition of Done
1. Criteria 1–5 hold.
