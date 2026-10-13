# TASKS 014 — JSONPath (RFC 9535)

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — Contract (risk-free / additive)
- [x] **T1** Vendor the CTS (`tests/query/jsonpath-cts/`: `cts.json` at commit
  `9d1a415a53f5dfb291bc874823892e49174e38eb`, its `LICENSE`, a `SOURCE` file with the URL and
  commit); write the RFC 9535 cases in `tests/query/jsonpath-rfc9535-<case>/` (`query.jsonpath`
  instead of `query.js`; wizard cases' text from the library's `jsonpathQueryLanguage.createQuery`);
  extend the loader, `tags.json`, the coverage test (criterion 3) and `tests/query/README.md`; a
  test that the CTS file is the pinned one (its `tests` count, 706, and a SHA-256 in `SOURCE`).
  — needs: 011 T2 — *gate: coverage test green; Reviewer PASS on P1–P7 per case*

## Phase B — Language (risk-free / additive)
- [x] **T2** `packages/app-shell/src/query/jsonpath-rfc9535.ts` per plan (engine with P6's
  options, P2 result, error mapping, `createQuery` from the library); `json-p3` 2.3.2 pinned;
  unit tests for criteria 1 and 2 and the fast-check suite for criterion 4 (seed committed,
  10 000 runs); `THIRD_PARTY_LICENSES.md`. — needs: 014 T1 — *gate: criteria 1, 2, 4 green;
  `pnpm check:licenses` green*

## Phase C — Dialog (risk-free / additive)
- [x] **T3** Add the language to `QUERY_LANGUAGES` between JMESPath and JSONPath (Goessner); the
  RFC link in `offline-allowlist.txt`; web tests for criteria 5, 6 and 9 in the dev host. — needs:
  014 T2 — *gate: criteria 5, 6 green in `pnpm test:web`; `pnpm check:offline` green with the
  Reviewer naming the new entry*

## Phase D — VS Code and size (risk-free / additive)
- [ ] **T4** e2e write-back fixtures in `tests/e2e/fixtures/query/jsonpath-rfc9535-*` (criterion
  7); leave the language out above the threshold (criterion 8) on 008's 6 MiB fixture, sharing 011
  T6's set of size-gated language ids if it has merged; `bench/query/jsonpath-*.jsonpath` and the
  RFC 9535 and Goessner columns in `bench/RESULTS.md` (criterion 10). Needs UNK-065 resolved. —
  needs: 014 T3, 008 T3 — *gate: criteria 7 and 8 green in `pnpm test:e2e`; criterion 10 holds in
  the committed `bench/RESULTS.md` (or its owner UNKNOWN is recorded)*

## Off the critical path
- Naming: the spec PR is reviewed as "014-T1"; the corpus task's PR is the first real 014 T1, and
  its verdict is read on its own head SHA.
- The README's query section (spec 005) names the main RFC 9535 vs Goessner differences (the
  corpus's `goessner-only` cases).
- Once spec 013 merges, its web test lists the language (criterion 9); 013's coverage map gains no
  new command, since this adds none.
- Copy path as RFC 9535 normalized path belongs to 018; remembering the last language to 019.
- Spec 020 or any host whose engine is not V8 (014 T2 review): P6's stack-overflow check in
  `packages/app-shell/src/query/jsonpath-rfc9535.ts` (`isStackOverflow`) matches V8's
  `RangeError` text ("Maximum call stack size exceeded"); Chrome, Chromium and VS Code's webview
  all run V8. Firefox throws `InternalError: too much recursion`, so a non-V8 host widens the check.
- json-p3 2.3.2 sets `minIntIndex` from `options.maxIntIndex` (a typo in its `JSONPathEnvironment`
  constructor; 014 T2 review). Unreachable here, since `jsonpath-rfc9535.ts` passes neither option;
  recheck it on a json-p3 upgrade or before passing either.
- Follow-up (014 T3, not filed): in Chromium, tree mode cannot show data nested deeper than about
  130 levels of arrays (165 to 180 of objects, per the 014 T3 review), and the Transform dialog cannot open on it in any mode (a stack overflow in the
  library's Svelte tree). Criterion 6's too-deep case is therefore proven in the unit corpus only.
