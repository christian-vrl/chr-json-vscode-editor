# TASKS 004 — Offline JSON Schema validation

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Spike (risk-free / additive)
- [x] **T1** (Large) Prototype options A and B inside the real webview from 003 T4; record for each: validates under the real CSP (yes/no), time to validate a 1 MB document against a 200-rule schema, reusable as an MV3 sandbox page (yes/no). Write `spikes/eval-location/REPORT.md`; fill ADR-010 per UNK-011's rule. — needs: 003 T4 — *gate: report committed with both options measured; UNK-011 resolved per the delegation rule*

## Phase B — Build (risk-free / additive)
- [x] **T2** Implement the chosen eval location. — *gate: spec 003 criterion 6 still green; one sample schema validates in e2e*
- [x] **T3** Association resolver per criterion 1; confirm the `json5.schemas` setting name from the Better JSON5 extension's `package.json` and cite it. `parallel` — *gate: criterion 1 table test green*
- [x] **T4** Ajv / `Ajv2019` / `Ajv2020` (and `ajv-draft-04` for draft-04, UNK-031) selected per UNK-017, `ajv-formats`, bundled meta-schemas, no `loadSchema`; fixtures in `tests/schema/`. — *gate: criteria 2, 3 green*
- [x] **T5** Inline errors in tree, table, text for all three formats. — needs: 003 T5 — *gate: criterion 5 green*

## Off the critical path
- Spec 011 (JS/Lodash queries) reuses the eval location chosen in T1.
