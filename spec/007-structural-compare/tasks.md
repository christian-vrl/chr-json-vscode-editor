# TASKS 007 — Structural compare

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Core and Git (risk-free / additive)
- [x] **T1** (Large) `compare(left, right)` and `copyDifference(source, target, d)` in
  `packages/core/src/compare.ts`, exported from `@chr-json-editor/core`; fast-check suite for
  criteria 1–2 (seed committed, 10 000 runs). — needs: 002 T9 — *gate: criteria 1, 2 property suite green*
- [x] **T2** HEAD reader per UNK-038's evidence rule, with e2e on a temp repository: committed file
  with an unsaved edit, untracked file, folder outside Git. `parallel` with T1 — needs: 003 T3 —
  *gate: e2e reads HEAD text byte-equal to the committed bytes; UNK-038 resolved per the delegation rule*

## Phase B — UI (risk-free / additive)
- [x] **T3** Compare page in `app-shell` (`Compare.svelte`, `CompareHostAdapter`, dev host),
  read-only tree panels per UNK-036, class marking, counter, Next/Previous, copy buttons; fixtures in
  `tests/compare/`. Needs UNK-036 resolved. — needs: 007 T1 — *gate: criterion 3 and the theme part of
  criterion 9 green in `pnpm test:web`*
- [x] **T4** VS Code compare panel: webview with the 003 CSP, the three commands and their menus,
  copy as `WorkspaceEdit` via `applyPatch`, background tab for an unopened target, live refresh,
  parse-error state. — needs: 007 T2, T3 — *gate: criteria 4–9 green in `pnpm test:e2e`; `pnpm check:offline` green*

## Phase C — Limits (risk-free / additive)
- [x] **T5** Benchmark compare (open to first render, and `compare` alone) on the 002 bench
  generator at 1, 5, 10, 50 MiB with about 1% of array items changed, on the CI runner; commit
  `bench/compare.md`; resolve UNK-037 per its rule and implement criterion 10's fallback. — *gate:
  `bench/compare.md` committed; criterion 10 e2e green; UNK-037 resolved per the delegation rule*

## Off the critical path
- Spec 008 (large-file mode) may reuse UNK-037's threshold; compare against other commits or the
  index, and editable compare panels if UNK-036 picks read-only now, are later specs.
