# PLAN 002 — Format core: JSON, JSONC, JSON5

> Derives from spec `002`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Corpus first (D3): golden cases are written and reviewed before adapter code, so they are the
contract, not a mirror of the implementation. JSON and JSONC share one adapter on `jsonc-parser`
(JSON = JSONC with strict diagnostics). JSON5 gets its own adapter after a measured spike. The patch
layer maps each JSON Patch op to adapter primitives (`move` = remove + add, `copy` = add, `test` =
check only) and is atomic.

## Constraints / invariants
- `core` stays pure TypeScript with no DOM and no Node APIs.
- An `expected.*` file changes only with a spec change (AGENTS rule 5).
- No overwrite without snapshot/backup (D4): all work in branches.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Golden corpus + coverage test | cases with `case.json` tags | criterion 4 green; Reviewer checks every case against R1–R10 |
| B | Detection | table test | criterion 5 |
| C | JSON/JSONC primitives | adapter (`add`/`replace`/`remove`) | golden cases tagged add/replace/remove for json, jsonc |
| D | JSON5 spike + adapter | `spikes/json5-cst/REPORT.md`, ADR-009, adapter | per UNK-012 rule; add/replace/remove json5 cases |
| E | Patch layer | `applyPatch` with move/copy/test, atomicity | criteria 1–3 all cases |
| F | Stringify + benchmark | `stringify`, `bench/RESULTS.md` | criteria 6–7 |
| G | Whole-document actions | `diff`, comment-keeping compact/sort, repair spike | criteria 8–9; UNK-018 resolved |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 `jsonc-parser` `modify` output differs from R1–R6 | compute edits from `parseTree` offsets ourselves; golden cases catch it |
| R2 No JSON5 package passes | own recursive-descent parser recording offsets (the JSON5 grammar is small) |
| R3 Re-parse per edit too slow on large files | batch edits per message; measured in step F |

## Definition of Done
1. Criteria 1–9 pass in CI. 2. ADR-009 recorded per UNK-012's rule; UNK-018 resolved.
