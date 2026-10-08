# PLAN 004 — Offline JSON Schema validation

> Derives from spec `004`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Spike first, inside a real VS Code webview: option A is `packages/sandbox` in a child iframe with its
own CSP allowing `unsafe-eval` (also usable as an MV3 manifest sandbox page); option B runs Ajv in
the extension host (Node, no CSP) and sends errors to the webview, which feeds them to the library's
`validator` prop. UNK-011's evidence rule picks. Association and fixtures do not depend on the spike.

## Constraints / invariants
- Ajv is created without `loadSchema`; meta-schemas for 2019-09, 2020-12 and draft-07 are bundled.
- Validation never blocks editing; results arrive asynchronously and carry `docVersion`.
- No overwrite without snapshot/backup (D4).

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Spike UNK-011 | `spikes/eval-location/REPORT.md`, ADR-010 | UNK-011 resolved per delegation rule |
| B | Association | resolver + table test | criterion 1 |
| C | Validator | dialect fixtures | criteria 2–3 |
| D | Inline errors | e2e per format | criteria 4–5 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 A child iframe in a VS Code webview cannot get eval | option B |
| R2 The library's `validator` prop is synchronous | cache the latest results and push them with `updateProps` when they arrive |

## Definition of Done
1. Criteria 1–5 green in CI. 2. ADR-010 recorded.
