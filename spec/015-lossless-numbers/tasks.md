# TASKS 015 — Lossless big numbers

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Spike (risk-free / additive)
- [x] **T1** Webview spike: `vanilla-jsoneditor` 3.13.0 in the dev host with a lossless parser over
  `tests/e2e/fixtures/big-numbers/input.json`: tree and table render, inline edit and paste of a
  21-digit value, copy, search, the sort dialog through `onSortModal` and the table header sort,
  JSONQuery/JMESPath/JSONPath on a rounded copy; webview parser costs (pre-scan regex vs char loop,
  core parse, lossless-json parse) at 5 and 50 MiB. Commit `spikes/lossless-numbers/` with its
  `REPORT.md` answering plan R1 and R2. `parallel` with T2 — *gate: REPORT answers R1, R2 with
  measured numbers; the fixture committed*

## Phase B — Core (risk-free / additive)
- [x] **T2** Read and write exactly: `lossless-json` 4.3.1 in `core` (licenses, ADR-014),
  `numberValue`, B1 in every adapter, the tree, `parseData` and `jsonl`; B2 in every writer;
  golden cases for criterion 1 except the `test` and `sort` ones; the big-number generator and
  criterion 2's property; bench rows (criterion 11, core part). It edits `parse-data.ts` and
  `json5-parser.ts`, which the JSON5 speed-up (008 T1 reopened for UNK-064) also changes: whichever
  merges later updates from `main`, scratch-merges the other first, and re-runs 008 criterion 7
  — *gate: criteria 1 (minus `test` and `sort` cases), 2, 14; `pnpm test:golden` and 008 criterion 6 green*
- [x] **T3** Equal and ordered by value: `compareNumbers`, B3 in `diff`, `compare`, `test`, `sort`;
  the `test` and `sort` golden cases and criterion 3's tests; CSV export B9 and import per UNK-067
  with criterion 10's cases. — needs: 015 T2 — *gate: criteria 1, 3, 10 green*

## Phase C — Editor (risk-free / additive)
- [x] **T4** Editor page and host: `parser.ts` (pre-scan per T1, lossless `stringify`), `keyOf`,
  the sort comparator, the protocol's `valueText` and version bump, Ajv's nearest-number input,
  compare page and copy-across, the CSV panel's preview and replace-data messages (009 T4, on
  `main` or whichever of the two merges later); criterion 4's `.json`, `.jsonc` and `.json5`
  fixtures and e2e, criteria 5–7. — needs: 015 T1, 015 T3 — *gate: criteria 4 (three formats)–7
  green; 003/004/007 e2e and the CSV panel's e2e (if on `main`) green with no expected value
  changed*

## Phase D — Queries (risk-free / additive)
- [ ] **T5** Query rules: B7's restoring wrapper on JSONQuery, JMESPath, JSONPath (and RFC 9535 if
  014 T2 is on `main`), the preview message; B8 in the 011 engine bridge per UNK-066; the 011 Q2
  `bigint-result` cases updated as §Changes to approved specs says; criteria 8 and 9. — needs:
  015 T4, 011 T4 — *gate: criteria 8, 9 green; 011's corpus and property suite green*

## Phase E — Large files and web (risk-free / additive)
- [ ] **T6** Large files and web: bench of the 6, 10 and 50 MiB big-id documents in large-file
  mode; resolve UNK-068 per its rule; criterion 12; criterion 13's web case; README line on big
  numbers; criterion 4's `.jsonl` fixture in the JSON Lines editor, including its table and the
  protocol's `valueText` on line edits. — needs: 015 T4, 013 T4, 012 T5 — *gate: criteria 4
  (`.jsonl`), 11, 12, 13 green; UNK-068 resolved per the delegation rule*

## Off the critical path
- Exact `maximum`, `multipleOf` and `enum` on big numbers would need a JSON Schema validator with
  decimal arithmetic; Ajv compares floats.
- A parser setting like the site's (lossless or native) belongs to spec 019.
- Spec 014 (merged with #89; its tasks are open): if 014 T2 lands after 015 T5, 014 T2 wraps its
  RFC 9535 language with T5's restoring wrapper and adds criterion 8's cases.
