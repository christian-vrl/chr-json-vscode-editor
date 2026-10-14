# TASKS 019 — Settings

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Host (risk-free / additive)
- [x] **T1** `contributes.configuration` with §Settings' keys; `src/settings.ts` (`readSettings`,
  the pure `settingsFrom`, A6's fallbacks) and its unit table; M1 in `init.mode`; V1 in the
  validation controller (live, A5); `chrJsonEditor.openSettings` (C1) in `contributes.commands`,
  `menus.commandPalette`, `src/activate.ts`, `test/web/coverage.json` and a web e2e case; the
  `onDidChangeConfiguration` listener (A1). Touches the shared `package.json` menus, `src/activate.ts`
  and `test/web/coverage.json`. — *gate: criteria 1, 2, 3, 8, 11 green; the existing e2e suites
  unchanged and green*

## Phase B — The page (risk-free / additive)
- [x] **T2** Typed `EditorSettings` in `init.settings` and the `settings` host → page message (one
  protocol bump); `App.svelte`: D1 and D2 library props with `updateProps`, Q1's starting language,
  `size-gate.ts` reading `thresholdBytes`; the host posts `settings` to open tabs on change (A2); the
  dev host takes settings; `tests/web` cases. — needs: 019 T1 — *gate: criteria 7, 9 green; the
  existing web suite unchanged and green*

## Phase C — Threshold (risk-free / additive)
- [x] **T3** The threshold from the setting in `largeFile.ts`, `smartFormatPlan.ts` and every other
  host gate on `main` that uses spec 008's threshold, and in the page's settings; plan R6's guard
  test; e2e on 008's fixtures with the setting at 6 and 1. — needs: 019 T2 — *gate: criterion 4
  green; 008, 010 and 011 large-file e2e unchanged and green at the default*

## Phase D — Smart Format (risk-free / additive)
- [x] **T4** `maxLineLength` as an option of core's `smartFormat`; golden cases with `options.json`
  at 60 and 200 per format (the corpus README names the file); the host passes F1's value. `parallel`
  with T2 and T3. — needs: 019 T1 — *gate: criterion 5 green; every existing smart-format golden
  case unchanged*

## Phase E — Indentation (risk-free / additive)
- [ ] **T5** (per UNK-088) Core reports "no indentation found" and takes a fallback indent in
  `applyPatch`, `stringify`, convert and the CSV writer (default 2 spaces); the host passes I1's
  indent to edits, Format, Smart Format, "Convert CSV to JSON", JSON Lines → JSON, "Generate JSON
  Schema" and the YAML/TOML/XML converts; unit and e2e cases. — needs: 019 T1, 016 T3, 017 T3 —
  *gate: criterion 6 green; every golden and property suite of 002, 006, 009, 010, 012, 016 and 017
  unchanged and green*

## Phase F — Web (risk-free / additive)
- [ ] **T6** Criterion 10's cases in the web e2e suite (workspace settings in the web test
  workspace). — needs: 019 T3 — *gate: criterion 10 green in the web e2e suite*

## Off the critical path
- Naming: the spec PR is reviewed as "019-T1"; the first real 019 T1's PR is reviewed on its own
  head SHA.
- README (spec 005): the settings section of the plan's Definition of Done, written by 005 T1 if it
  runs after T1, else by T1.
- Later threshold gates (016 T4, 017 T4, 018 T4) take the threshold from `largeFile.ts`'s function
  whether or not T3 has merged.
