# TASKS 011 — JavaScript and Lodash queries

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Proof (risk-free / additive)
- [x] **T1** Spike in `spikes/query-engine/` (dev-only, like `spikes/eval-location/`): a custom editor
  webview rendered by `renderWebviewHtml` with `'wasm-unsafe-eval'` added to `script-src`, loading
  the QuickJS single-file browser module from a nonce'd script; run the spec's sealed probes, the
  5-second loop, the allocation loop at 256 MiB, criterion 5's built-in cases and the 1 and 5 MiB
  bench queries in the webview on VS Code 1.141.0; check how the engine chunk loads under the nonce
  CSP (plan R7) and how the preview behaves while typing on 5 MiB (plan R2); record no CSP
  violation, the loading route, the stop times, the typing measurements and the speeds in
  `REPORT.md`. Needs UNK-048 resolved. — needs: 003 T4 (CSP) — *gate: the spec's CSP HYPOTHESIS
  confirmed with results committed, or the spec changed and an owner UNKNOWN raised; Reviewer PASS
  on the report*

## Phase B — Contract (risk-free / additive)
- [x] **T2** Write the query corpus in `tests/query/<case>/` (`input.json5`, `case.json`, `query.js`,
  `expected.json5` or `error.json`), wizard cases generated with the library's `createQuery`, plus the
  coverage test (criterion 2) and the reference runner (the library's `executeQuery` in Node); add
  the folder to `.prettierignore`. `parallel` with T1 — needs: 003 T8 — *gate: coverage test green;
  every case without a Q2 tag matches the reference; Reviewer PASS on Q1–Q5 per case*

## Phase C — Engine (risk-free / additive)
- [x] **T3** (Large) `runQuery` in `packages/app-shell/src/query/`: QuickJS runtime per run, limits,
  the bridge in and out (Q2), Lodash loaded from a bundled string, error mapping; dependencies pinned
  per plan; unit tests for criterion 1 and the fast-check suite for criterion 3 (seed committed,
  10 000 runs per language). — needs: 011 T1, T2 — *gate: criteria 1 and 3 green;
  `pnpm check:licenses` green*

## Phase D — Editor (risk-free / additive)
- [x] **T4** JavaScript and Lodash in `QUERY_LANGUAGES` with our `executeQuery`; lazy engine chunk
  compiled on the first Transform; the dev host's CSP mirrors the editor's; web tests for criteria
  4, 5, 6, 8 and 10 with fixtures in `tests/query/sealed/`. — needs: 011 T3 — *gate: criteria 4, 5,
  6, 8, 10 green in `pnpm test:web`*

## Phase E — VS Code (risk-free / additive)
- [x] **T5** `'wasm-unsafe-eval'` in the CHR JSON editor webview's CSP only (panels unchanged) and
  `assertCriterion6`'s variant; e2e write-back fixtures in `tests/e2e/fixtures/query/`; `bench/query/`
  queries and the engine column in `bench/RESULTS.md`; `THIRD_PARTY_LICENSES.md`; `.vsix` size
  change in the PR body. — needs: 011 T4 — *gate: criteria 7 and 9 green in `pnpm test:e2e` and
  `pnpm check:offline`; criterion 12 holds in the committed `bench/RESULTS.md` (or its owner UNKNOWN
  is recorded); criterion 13*

## Phase F — Large files (risk-free / additive)
- [ ] **T6** Leave JavaScript and Lodash out of the list in a large-file tab (unlocked); e2e on 008's
  6 MiB fixture. Needs UNK-049 resolved. — needs: 011 T5, 008 T3 — *gate: criterion 11 green in
  `pnpm test:e2e`*

## Off the critical path
- Naming: the spec PR is reviewed as "011-T1"; the spike task's PR is the first real 011 T1, and its
  verdict is read on its own head SHA.
- Remembering the last query language and the time and memory limits as settings belong to 019.
- The vscode.dev build (013) and the Chrome app (020) reuse `runQuery`; each checks the
  `'wasm-unsafe-eval'` CSP in its own spec.
