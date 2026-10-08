# PLAN 001 — Repo foundation and CI guards

> Derives from spec `001`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
The owner creates an empty repo; an agent installs the kit non-destructively, then adds the
workspace, the standard scripts, and each CI guard together with a negative test that proves the
guard fails when it should (constitution §3, falsifiability). Every later gate relies on these.

## Constraints / invariants
- No overwrite without snapshot/backup (D4): run `bootstrap.sh --dry-run` first; commit the kit's output before the project-filled files, so history shows template → filled.
- No secrets in the repo.
- Standard script names are fixed by `AGENTS.md`; later specs only add to them.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Repo + kit + research snapshots | first commits | criterion 5 |
| B | Workspace + scripts | `pnpm build` log | exit 0 on clean clone |
| C | Test harnesses | sample unit, golden, e2e, web tests | each green in CI |
| D | Guards | license, offline, gate-review checks with negative fixtures | criteria 3–4 |
| E | CI + protection | `ci.yml`, branch protection | criterion 1; protected `main` |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 VS Code e2e needs a display | `xvfb-run` on ubuntu runners |
| R2 Offline scan flags URLs inside license text or comments in bundles | `offline-allowlist.txt`; each new entry named by the Reviewer |
| R3 Library updates change bundles | exact versions; dependency-update PRs must pass every guard |
| R4 Anyone can comment on a public repo | `gate-review` counts only comments from collaborators with write access |

## Definition of Done
1. Criteria 1–5 hold on `main`.
2. `main` is protected with the CI jobs and `gate-review` as required checks.
