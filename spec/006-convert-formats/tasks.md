# TASKS 006 — Convert between JSON, JSONC and JSON5

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** Write the conversion corpus in `tests/golden/convert/<from>-to-<to>/` for all six pairs:
  hand-written `expected.*` bytes, `losses.json`, `case.json` tags, plus the coverage test; add the
  folder to `.prettierignore` and to `pnpm test:golden`. Needs UNK-033 and UNK-034 resolved. — needs:
  002 T1 (golden corpus and `pnpm test:golden`) — *gate: `pnpm test:golden -- --coverage-only` green (criterion 2); Reviewer PASS on C1–C7 per case*

## Phase B — Core (risk-free / additive)
- [x] **T2** `convert(text, from, to) → { text, losses }` in `packages/core/src/formats/convert.ts`,
  exported from `@chr-json-editor/core`, on the token streams of 002 T3 (`tokenize`) and 002 T5
  (`parseJson5`); fast-check suite for criteria 3–5 (seed committed, 10 000
  runs per pair); time on the 002 bench documents (1, 10, 50 MB) recorded in the PR body. — needs: 002 T3, 002 T5 — *gate:
  criterion 1 all cases green; criteria 3–5 property suite green*

## Phase C — VS Code (risk-free / additive)
- [x] **T3** Commands `chrJsonEditor.convertToJson`, `…ToJsonc`, `…ToJson5` (palette and editor
  title, in the custom and text editors, hiding the document's own format), loss modal, write per
  UNK-035, broken-source message; e2e for criteria 6–7. Needs UNK-035 resolved. — needs: 003 T3 —
  *gate: criteria 6, 7 green in `pnpm test:e2e`; `pnpm check:offline` green (criterion 8)*

## Off the critical path
- Spec 010 (smart format) and spec 019 (settings) may later add "format after converting"; not here.
