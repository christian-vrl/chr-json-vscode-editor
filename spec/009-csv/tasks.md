# TASKS 009 — CSV import and export

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** Write the CSV corpus in `tests/golden/csv/export/` and `tests/golden/csv/import/`:
  hand-written `expected.csv` bytes, `expected.json` data, `warnings.json` and `error.json`,
  `options.json` and `case.json` tags, plus the coverage test; add the folder to `.prettierignore`
  and to `pnpm test:golden`. Needs UNK-043 resolved. — needs: 002 T1 (golden corpus and
  `pnpm test:golden`) — *gate: `pnpm test:golden -- --coverage-only` green (criterion 2); Reviewer
  PASS on X1–X7 and I1–I7 per case*

## Phase B — Core (risk-free / additive)
- [x] **T2** `jsonToCsv`, `csvToJson` and `detectDelimiter` in `packages/core/src/csv/`, exported
  from `@chr-json-editor/core`; fast-check suite for criterion 3 (seed committed, 10 000 runs);
  export and import times at 1, 10 and 50 MiB on the `bench/generate.mjs` documents (arrays of
  records) recorded in the PR body. — needs: 009 T1 — *gate: criterion 1 all cases green; criterion 3
  property suite green*

## Phase C — UI (risk-free / additive)
- [ ] **T3** CSV panel page in `app-shell` (`Csv.svelte`, `CsvHostAdapter`, dev host): options with
  defaults, preview of the first 100 rows, warnings, error state, buttons per mode; fixtures in
  `tests/csv/`. Needs UNK-042 and UNK-044 resolved. — needs: 009 T2 — *gate: criterion 6 and the
  theme part of criterion 9 green in `pnpm test:web`*
- [ ] **T4** VS Code CSV panel: `WebviewPanel` with the 003 CSP, the commands "Export to CSV…",
  "Import CSV…" and "Convert CSV to JSON" with their menus, save, copy, create file and replace
  document data (R14, one `WorkspaceEdit`), the row-source message from the editor webview (protocol
  bump; verify the table-mode HYPOTHESIS first), the broken-source message, the size checks; e2e.
  — needs: 009 T3, 003 T3 — *gate: criteria 4, 5, 7, 8 green in `pnpm test:e2e`; `pnpm check:offline`
  green (criterion 9)*

## Phase D — Large files (risk-free / additive)
- [ ] **T5** Spec 008 integration: "Import CSV…" and "Replace Document Data" hidden in a locked tab
  and back after "Edit anyway"; export from a locked tab through `parseData`; e2e on a
  6 MiB fixture. — needs: 009 T4, 008 T3 — *gate: criterion 10 green in `pnpm test:e2e`*

## Off the critical path
- Spec 008 decides how a created JSON file above the threshold opens; criterion 8 only checks that
  it opens that way, so T4 uses whatever 008 has merged by then (normal editor before 008 T3) and T5
  re-checks it.
- Naming: the spec PR (#62) was reviewed as "009-T1"; the corpus task's PR is the first real 009 T1,
  and its verdict is read on its own head SHA.
- Opening `.csv` files directly in table mode, other encodings and column choice could be a later
  spec; spec 012 (NDJSON in table mode) is the nearest neighbor.
