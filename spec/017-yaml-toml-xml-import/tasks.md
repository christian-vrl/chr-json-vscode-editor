# TASKS 017 — YAML, TOML and XML import

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Corpus (risk-free / additive)
- [x] **T1** Write the corpus in `tests/golden/import/<kind>/<case>/` (`input.<ext>`, `case.json`
  with `rules` and `tags`, hand-written `expected.json` with `warnings.json`, or `error.json`; the
  folder added to `.prettierignore`, since files compare byte for byte) with a `README.md` naming
  the layout, the rules A1–A6, Y1–Y8, TM1–TM5, XM1–XM8 and any reading a rule needed; the `import`
  section of `tests/golden/tags.json`; a coverage test (criterion 2) that checks the cases' tags,
  run under `--coverage-only` like the CSV and convert corpora. No importer yet.
  — *gate: criterion 2 green; Reviewer PASS on each `expected.json` against the rules*

## Phase B — Importer (risk-free / additive)
- [x] **T2** `yaml` 2.9.1, `smol-toml` 1.9.0 and `saxes` 6.0.0 as `core` dependencies (exact
  versions); `importData(text, kind)` in `packages/core/src/import/` per the plan, exported from
  core; the golden test (criterion 1), the round-trip property suite (criterion 3, seed committed)
  and the hostile-input tests (criterion 4). — needs: 017 T1, 015 T2 — *gate: criteria 1–4 green;
  `pnpm check:licenses` green*

## Phase C — Commands (risk-free / additive)
- [ ] **T3** "Convert YAML to JSON", "Convert TOML to JSON", "Convert XML to JSON" and "Import
  YAML, TOML or XML…" with their explorer, editor-title and palette entries (`when` clauses on
  `resourceExtname`), the file beside the source with the save-dialog and untitled fallbacks, the
  confirmation and 002 R14 replace, the error message, the warnings notification and output
  channel; e2e fixtures in `tests/e2e/fixtures/import/` and `tests/import/replace/`; the libraries
  in both host bundles and not in the webview bundle; offline allowlist entries for the Reviewer
  to name. — needs: 017 T2, 009 T4 — *gate: criteria 5, 6 (JSON, JSONC, JSON5 tabs), 7 green in
  `pnpm test:e2e`; criterion 12 green*

## Phase D — Size and JSON Lines (risk-free / additive)
- [ ] **T4** Size checks and the progress notification (criterion 8), the locked-tab case
  (criterion 9) on spec 008's fixture, the JSON Lines case of criterion 6; YAML, TOML and XML bench
  documents from the bench generator, `importData` in the bench and `bench/RESULTS.md`
  (criterion 10); resolve UNK-077 from that run and set the YAML limit in the code. — needs:
  017 T3, 012 T5 — *gate: criteria 6 (JSON Lines), 8, 9, 10 green; UNK-077 row resolved
  (delegated) with the run linked*

## Phase E — Web (risk-free / additive)
- [ ] **T5** One criterion 5 case per kind in the web e2e suite and the four commands in spec 013's
  coverage map. `parallel` with T4. — needs: 017 T3, 013 T4 — *gate: criterion 11 green in the
  web e2e suite*

## Off the critical path
- Naming: the spec PR is reviewed as "017-T1"; the corpus task's PR is the first real 017 T1, and
  its verdict is read on its own head SHA.
- README (spec 005): one line per command; say that comments are not carried and that the source
  file is never changed.
- Export to YAML, TOML or XML is not in 017 (UNK-076: import only); a later backlog item may add
  it, and the importer's walk has no writer half to keep in step.
- Notes from the spec review (017-T1 on PR #99), for the tasks named:
  - T2: also run criterion 3's generator on `-0` and on keys `__proto__` and `constructor` (A4),
    as extra unit cases beside the property suite.
  - T3: the browser-entry check of spec 013 criterion 1 (no `require(` but `require("vscode")`)
    covers the three libraries once they are bundled; confirm it passes with them.
  - T4: criterion 10's numbers are sandbox HYPOTHESES; the committed `bench/RESULTS.md` run is the
    evidence, and a miss of the 2 s TOML/XML bound is recorded as an UNK, not met by lowering it.
