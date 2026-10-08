# TASKS 002 — Format core: JSON, JSONC, JSON5

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** (Large) Write the golden corpus covering every cell of criterion 4, hand-written `expected.*` bytes, `case.json` tags, plus the coverage test. Needs UNK-008 resolved for `remove`/`move` cases. — needs: 001 T4 — *gate: `pnpm test:golden -- --coverage-only` green (every cell covered); Reviewer PASS on R1–R10 per case*
- [x] **T2** `detect` per R11 with strict-JSON diagnostics. `parallel` — *gate: criterion 5 table test green*

## Phase B — Adapters (risk-free / additive)
- [x] **T3** `FormatAdapter` + `Style` detection + JSON/JSONC adapter primitives on `jsonc-parser`. — *gate: `pnpm test:golden -- --format json,jsonc --op add,replace,remove` green*
- [x] **T4** (Large) Spike per UNK-012's evidence rule; `spikes/json5-cst/REPORT.md` with pass counts per option; fill ADR-009. `parallel` with T3 — *gate: report committed; UNK-012 resolved per the delegation rule*
- [ ] **T5** JSON5 adapter per ADR-009. — *gate: `pnpm test:golden -- --format json5 --op add,replace,remove` green*

## Phase C — Proof (risk-free / additive)
- [ ] **T6** (Large) Patch layer `applyPatch(text, patch, format)` with `move`/`copy`/`test`, atomic per R9; fast-check suite per criterion 3. — *gate: `pnpm test:golden` all cases green and property suite 10 000 runs/format green*
- [x] **T7** `stringify(data, format, style)`. `parallel` — *gate: criterion 6 property test green*
- [ ] **T8** Benchmark per criterion 7. — *gate: `bench/RESULTS.md` committed*

## Phase D — Whole-document actions keep comments (risk-free / additive)
- [ ] **T9** (Large) Structural `diff(a, b) → JSON Patch` with LCS on deep-equal array items (reused by spec 007 compare). — *gate: criterion 9 property suite green*
- [ ] **T10** Comment-keeping `compact` (R12) and `sort` (R13) for all three formats, plus golden cases tagged `compact`, `sort`, `data-diff` (R14). `parallel` with T9 — *gate: criterion 8 green*
- [x] **T11** (Large) Spike per UNK-018: comment-keeping repair of 20 broken commented JSONC/JSON5 fixtures (mask comments, repair, re-anchor); `spikes/repair-comments/REPORT.md`. `parallel` — *gate: report with keep-count per fixture; UNK-018 resolved per the delegation rule*

## Off the critical path
- Spec 006 (conversion) reuses T7.
