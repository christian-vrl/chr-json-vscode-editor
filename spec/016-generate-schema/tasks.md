# TASKS 016 — Generate JSON Schema

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Generator (risk-free / additive)
- [x] **T1** Write the corpus in `tests/schema-gen/<case>/` (`input.<ext>`, `case.json` with
  `format`, `dialect` and `tags`, hand-written `expected.schema.json`; the folder added to
  `.prettierignore`, since files compare byte for byte) with a `README.md` naming the
  layout and G1–G9; `generateSchema(data, dialect)` in `packages/core/src/schema/generate.ts`,
  exported from core; the corpus test (criterion 1) and the coverage test (criterion 2).
  — *gate: criteria 1, 2 green; Reviewer PASS on G1–G9 per case*

## Phase B — Validator (mutation of an approved behavior; covered by the spec approval)
- [x] **T2** `ownProperties: true` in `compileSchema` (`packages/vscode-extension/src/validation.ts`)
  (spec 004 criterion 2 as amended); the criterion 4 unit test; the fast-check suite for criterion 3
  (seed committed, 10 000 runs per dialect) in `packages/vscode-extension`, using `compileSchema`
  and Ajv's `validateSchema`. — needs: 016 T1 — *gate: criteria 3, 4 green; every `tests/schema/`
  fixture unchanged*

## Phase C — Command (risk-free / additive)
- [x] **T3** `chrJsonEditor.generateSchema` "Generate JSON Schema": command palette and
  editor-title menu (`when` clauses like the convert commands', for json, jsonc and json5), the
  schema file beside the source, the save-dialog and untitled fallbacks, the broken-source message,
  the notification and the link button per UNK-070; e2e fixtures in
  `tests/e2e/fixtures/generate-schema/`. — needs: 016 T2 — *gate: criteria
  5, 6, 7 green in `pnpm test:e2e`*

## Phase D — JSON Lines and size (risk-free / additive)
- [x] **T4** The command on `jsonl` documents (G8, no link button) in both editors; the locked
  large-file case on spec 008's fixture and the progress notification above the threshold;
  `generateSchema` beside `parseData` in the bench and `bench/RESULTS.md` (criterion 9). — needs:
  016 T3, 012 T5 — *gate: criteria 8, 9 green; criterion 9's bound holds in the committed
  `bench/RESULTS.md`*

## Phase E — Web (risk-free / additive)
- [ ] **T5** The criterion 5 `.json` case in the web e2e suite and the command in spec 013's
  coverage map. `parallel` with T4. — needs: 016 T3, 013 T4 — *gate: criterion 10 green in the
  web e2e suite*

## Off the critical path
- 016 T3 ran criterion 5's `.json` case on the web host too (`test/web/suite/generateSchema.ts`),
  because spec 013's coverage test fails for a command with no web test; T5 adds the save-dialog
  case and keeps criterion 10's gate. T3's e2e (`test/e2e/generateSchema.cjs`) runs in a second
  VS Code launch with a workspace folder open (criterion 7's button needs one).
- Gate review of the spec PR (lows carried here, criteria unchanged): T5 also runs criterion 5's
  "file exists" case (save dialog, then Cancel) on the web host; if criterion 9's bound misses on
  the CI runner, T4 records an owner UNKNOWN before it merges instead of relaxing the bound.
- Naming: the spec PR is reviewed as "016-T1"; the corpus task's PR is the first real 016 T1, and
  its verdict is read on its own head SHA.
- Big numbers: whichever of 016 T1 and 015 T2 merges later adds a `big-number` corpus case (a
  19-digit id typed `integer`, `1e400` typed `number`, G1) and the tag to the coverage test.
- 016 T4 (from the #133 review): the link e2e also runs for a folder path with spaces. Not
  covered: a path with `#` or `?`, which `Uri.toString(true)` (what the resolver matches) still
  escapes while the link's `fileMatch` is the decoded path; a later task can decide whether the
  link should escape them.
- README (spec 005): one line on the command and that the schema says only which keys exist and
  their types (G5).
- Options (formats, enums, map detection, `$defs`) would be a later spec's dialog; settings
  belong to 019.
