# TASKS 005 — v1 release

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Content (risk-free / additive)
- [ ] **T1** README (features, offline promise, ADR-007 credit, sponsor link), CHANGELOG, icon, marketplace fields; `pnpm check:readme`. — needs: 003 T12 — *gate: criteria 1, 2 green*
- [ ] **T2** `release.yml` per criterion 3 plus a PR dry-run job. `parallel` — *gate: dry run green; Reviewer confirms criterion 3 from the workflow file*

## Phase B — Publish (requires approval)
- [~] **T3** Owner creates the Marketplace publisher and Open VSX access per the plan's runbook. — *gate: owner confirms*
- [~] **T4** Owner creates the `release` environment with themself as required reviewer and adds `VSCE_PAT`, `OVSX_PAT`. — *gate: `gh api repos/<owner>/<repo>/environments/release` shows the protection rule*
- [~] **T5** Agent pushes tag `v1.0.0`; owner approves the run. — *gate: criterion 4*

## Off the critical path
- Chrome Web Store listing belongs to spec 020.
