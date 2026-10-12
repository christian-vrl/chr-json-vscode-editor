# TASKS 012 — JSON Lines (NDJSON)

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** Write the JSON Lines corpus in `tests/golden/jsonl/` (patch cases with hand-written
  `expected.jsonl` or `error.json`, parse cases with `data.json` and `diagnostics.json`,
  `repairLines` cases) and the conversion cases in `tests/golden/convert/jsonl-to-{json,jsonc,json5}/`
  and `{json,jsonc,json5}-to-jsonl/`, with `case.json` tags and the coverage test; add the folder to
  `.prettierignore` and to `pnpm test:golden`. (UNK-050 and UNK-051 resolved.) — needs: 002 T1,
  006 T1 — *gate: `pnpm test:golden -- --coverage-only` green (criterion 2); Reviewer PASS on
  L1–L10 and J1–J2 per case*

## Phase B — Core (risk-free / additive)
- [x] **T2** (Large) `'jsonl'` in `Format`; the `jsonl` adapter in
  `packages/core/src/formats/jsonl-adapter.ts` (parse, `applyPatch`, `stringify`, `sort`, `compact`,
  `prettyPrint`); `detect` entries for languageId `jsonl` and `.jsonl`/`.ndjson`; `parseData` for
  `jsonl`; fast-check suite for criterion 3 (seed committed, 10 000 runs); `jsonl` rows in
  `bench/RESULTS.md` (criterion 12). — needs: 012 T1, 008 T1 — *gate: criteria 1, 3, 4, 12 green;
  every existing golden and property suite unchanged and green*
- [ ] **T3** `convert` for the `jsonl` pairs (J1, J2) and `repairLines` (L10) in core; property suite
  for criterion 5. — needs: 012 T2, 006 T2 — *gate:
  criterion 5 and the L10 golden cases green*

## Phase C — UI (risk-free / additive)
- [ ] **T4** app-shell: `parserFor('jsonl')` without the `JSON.parse` fast path; Table and Tree only
  with Table first for `jsonl`; the bad-line banner (read-only, "Open as Text", "Repair Lines"
  requests to the host, protocol bump); whole-document actions hidden per criterion 6; dev host
  fixtures; web tests. — needs: 012 T2, 008 T2 — *gate: criterion 8's banner and read-only parts and
  the theme part of criterion 13 green in `pnpm test:web`*
- [ ] **T5** VS Code: `*.jsonl` and `*.ndjson` in the custom editor selector and in every
  `resourceExtname` and format `when` clause; "JSON Lines" in the format badge and picker; open in
  Table mode; "Repair Lines" as one `WorkspaceEdit` and "Open as Text" at the first bad line; "Convert
  to JSON Lines" and the `jsonl` sources of "Convert to JSON / JSONC / JSON5"; e2e. — needs: 012 T3,
  012 T4, 006 T3 — *gate: criteria 6, 7, 8, 9 green in `pnpm test:e2e`; `pnpm check:offline` green*

## Phase D — Large files and CSV (risk-free / additive)
- [ ] **T6** Spec 008 and 009 on JSON Lines: large-file mode in Table mode with both banners,
  "Edit anyway" blocked while bad lines remain, `parseData('jsonl')` in the host and webview; CSV
  export and replace on `jsonl` tabs; e2e on a 6 MiB fixture and a small one. — needs: 012 T5,
  008 T3, 009 T4 — *gate: criteria 10, 11 green in `pnpm test:e2e`*

## Off the critical path
- Naming: the spec PR is reviewed as "012-T1"; the corpus task's PR is the first real 012 T1, and
  its verdict is read on its own head SHA (as 009).
- Schema validation of each item (a schema that describes one record) could be a later spec; it
  needs a way to bind a schema to a JSON Lines file, which 004's `$schema`/settings lookup lacks.
- Compare of two JSON Lines files (007) should work through the adapter once T2 merges; 007 adds no
  criterion for it here.
- Opening `.csv` files directly in table mode (009 §Off the critical path) could reuse T4's Table-first
  state.
