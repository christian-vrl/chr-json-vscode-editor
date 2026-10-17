# TASKS 018 — Copy path and reveal node

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Core (risk-free / additive)
- [x] **T1** Write the corpus in `tests/paths/<case>/` (`input.<ext>`, `case.json` with `format` and
  `tags`, hand-written `expected.json`; the folder added to `.prettierignore`, since the offsets refer to
  the files as written) with a `README.md` naming the layout and P1–P4, A1–A6, R1–R3;
  `jsonPath`, `jsonPointer`, `readPath`, `nodeAt` and `placeOf` in `packages/core/src/paths/`,
  exported from core, with the JSON5 lexer usable on its own; the corpus test (criterion 1), the
  coverage test (criterion 2), and criterion 3's round trip and grammar checks and criterion 4's
  suite (seeds committed). — *gate: criteria 1, 2, 4 and criterion 3 without its engine check green;
  every 002 golden and property suite unchanged and green; Reviewer PASS on the rules per case*

## Phase B — The page (risk-free / additive)
- [x] **T2** app-shell: S1's selection rule, S2's menu items, S3's `pathParser` and the copy-button
  interception, S4's mode switch; the messages (copy request, the current node's path on request,
  `reveal`) with one protocol bump; the dev host records copy requests; criterion 3's engine check
  with json-p3 (app-shell's dependency); `tests/web` cases. — needs: 018 T1 — *gate: criteria 3, 5, 6
  green; the existing web suite unchanged and green*

## Phase C — Commands (risk-free / additive)
- [x] **T3** `chrJsonEditor.copyJsonPath`, `chrJsonEditor.copyJsonPointer`,
  `chrJsonEditor.revealInEditor` and `chrJsonEditor.revealInText` per S5 and UNK-082: command
  palette and text editor context menu (`when` clauses with the format context keys, as the convert
  commands'), the status bar message, the reveal in both directions, S6's messages; e2e fixtures in
  `tests/e2e/fixtures/copy-path/`. — needs: 018 T2 — *gate: criteria 7, 8, 9 green in
  `pnpm test:e2e`*

## Phase D — JSON Lines and size (risk-free / additive)
- [x] **T4** The commands and reveals on `jsonl` documents in both editors (criterion 10); the
  locked large-file case on spec 008's fixture and the progress notification above the threshold;
  `nodeAt` and `placeOf` beside `parse` in the core bench and `bench/RESULTS.md` (criterion 11).
  — needs: 018 T3, 012 T5 — *gate: criteria 10, 11 green; criterion 11's bound holds in the
  committed `bench/RESULTS.md`*

## Phase E — Web (risk-free / additive)
- [x] **T5** Criterion 12's cases in the web e2e suite and the four commands in spec 013's coverage
  map. `parallel` with T4. — needs: 018 T3, 013 T4 — *gate: criterion 12 green in the web e2e
  suite*

## Off the critical path
- Naming: the spec PR is reviewed as "018-T1"; the corpus task's PR is the first real 018 T1, and its
  verdict is read on its own head SHA.
- If criterion 11's bound misses on the CI runner, T4 records an owner UNKNOWN before it merges
  instead of relaxing the bound.
- "Reveal in Text Editor" on a CHR JSON Editor tab with unsaved edits: "Reopen as Text" keeps that
  tab and opens the text editor beside it, which gets the cursor (018 T3 review, L4); the web suite
  covers it (018 T5).
- json-p3 2.3.2 refuses `\u0001`-style escapes that RFC 9535 §2.7 requires (§Current evidence):
  whoever next updates json-p3 re-runs criterion 3's engine check without the exclusion.
- README (spec 005): one line naming the four commands and the two notations.
- The navigation bar inside the library's "Edit nested content" dialog reads and writes its paths
  against the main editor's data, not the dialog's (018 T2 review, L1): a later page task can read
  them relative to the dialog's path, as the sort recording does (`recordSort`).
- Criterion 9's second case: the library drops a selection whose node an external edit removed, so
  the palette's "Reveal in Text Editor" then names the root; the stale path reaches the host from the
  context menu's item, which keeps the selection the menu opened on (018 T3).
- JSON Lines with a bad line (018 T4): A5 counts every non-blank line as an item, the bad one too,
  while the CHR editor's table (spec 012 L1) leaves a bad line out of its rows. Both reveals map the
  item to the row and back (`tablePath`, `textPath`; `middle.jsonl` in
  `copyPath.cjs`), so they land on the same item. Per UNK-090 ★ (the owner chose Keep)
  the copy commands in both editors write the text's A5 index, and the page's nav bar shows and
  accepts it; the helpers live in core (`packages/core/src/paths/lines.ts`), and `badItems` treats a
  lone CR at the end of a line as blank space, as `readLines` does (018 T3 review, L4).
- "Finding the node…" (criterion 11) uses the document's `chrJsonEditor.largeFileThreshold` (spec 019
  T1, merged while T4 was open), 5 MiB by default; `copyPathLargeFile.cjs` checks a 10 MiB setting.
- "Reveal in Text Editor" from a tab with unsaved edits: "Reopen as Text" keeps that tab open, so the
  command now takes the text tab from `showTextDocument` (018 T3 review, L4; covered in
  `copyPath.cjs`).
- Settings (a default notation, keybindings) belong to 019; the compare panel and CSV preview could
  reuse S2's menu items later.
