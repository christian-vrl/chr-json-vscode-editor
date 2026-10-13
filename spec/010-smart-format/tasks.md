# TASKS 010 — Smart format

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** Write the smart-format corpus in `tests/golden/smart-format/{json,jsonc,json5}/`:
  `input.*`, `expected.*` (generated with FracturedJson 5.1.0 and §Layout's options, then hand-checked
  and corrected for L1–L8), `case.json` tags, plus the coverage test; add the folder to
  `.prettierignore` and to `pnpm test:golden`. Needs UNK-045 and UNK-046 resolved. — needs: 002 T1
  (golden corpus and `pnpm test:golden`) — *gate: `pnpm test:golden -- --coverage-only` green
  (criterion 2); Reviewer PASS on L1–L8 per case*

## Phase B — Core (risk-free / additive)
- [x] **T2** (Large) `smartFormat(text, format)` in `packages/core/src/formats/smart-format.ts`,
  exported from `@chr-json-editor/core`, on `fracturedjsonjs` pinned to exactly 5.1.0: the JSON5
  bridge, the key-order override (or vendored copy), the trailing-comma pass, style handling;
  fast-check suite for criteria 3–6 (seed committed, 10 000 runs per format, plus every 002 and 006
  golden input); `smartFormat` column in the core bench and `bench/RESULTS.md` regenerated. Needs
  UNK-047 resolved. — needs: 010 T1, 002 T8 (core bench) — *gate: criterion 1 all cases green;
  criteria 3–6 property suite green; criterion 11 holds in the committed `bench/RESULTS.md` (or its
  owner UNKNOWN is recorded); `pnpm check:licenses` green*

## Phase C — VS Code (risk-free / additive)
- [ ] **T3** "Smart format" in the text mode menu, the `smartFormat` action (protocol bump) in
  app-shell, the dev host and the host's `runAction`; the `chrJsonEditor.smartFormat` command for the
  CHR JSON editor and the text editor; the broken-source message; the size guard of criterion 10
  (the command checks the text size before running, so no unguarded command ever ships), with e2e
  in the text editor on a 6 MiB fixture; fixtures in `tests/e2e/fixtures/smart-format/`; README
  credit for FracturedJson. — needs: 010 T2, 003 T8 — *gate: criterion 7 green in `pnpm test:web`;
  criteria 8, 9 and 10 (text editor) green in `pnpm test:e2e`; `pnpm check:offline` green*
- [ ] **T4** Large-file tabs: e2e for criterion 10 in a large-file tab on 008's 6 MiB fixture, locked
  and unlocked, and an unlocked tab edited down to 5 MiB or less that then smart-formats. — needs: 010 T3, 008 T3 — *gate: criterion 10 green in `pnpm test:e2e`*

## Off the critical path
- Options (line length, table and inline complexity, padding) belong to 019 (Settings) per UNK-047.
- Smart format of one node from the tree context menu, or a width function for East Asian text
  (plan R6), would be later specs if wanted.
