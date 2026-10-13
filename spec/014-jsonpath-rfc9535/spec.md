# SPEC 014 — JSONPath (RFC 9535)

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidSHoaiJt1vfe14AjQED6oy9, 2026-10-12)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
v1's Transform dialog offers JSONPath through the library's `jsonpathQueryLanguage`, which runs
jsonpath-plus: Goessner's 2007 JSONPath with its own extensions, labelled "JSONPath (Goessner)"
(003 T8). JSONPath has been an IETF standard since February 2024 (RFC 9535), and the standard
differs from Goessner's in places: filters are `?<expr>` with a fixed set of functions (`length`,
`count`, `match`, `search`, `value`) instead of script expressions, comparisons are typed, slices
and negative indexes have exact rules, and there is a shared compliance test suite. A user who
copies a query from another RFC 9535 tool (or from a spec, an API doc, a Kubernetes or database
manual) can get different results today without being told why. The feature map lists "RFC 9535
JSONPath engine alongside the library's Goessner-style one" as P2, and ADR-005 records "JSONPath =
library's Goessner-style now, RFC 9535 engine in P2".

## Goal
The Transform dialog offers "JSONPath (RFC 9535)" beside "JSONPath (Goessner)": the user writes or
builds (with the wizard) a standard JSONPath query, the live preview shows the matched values, and
Transform writes them back like any other transform, keeping comments, with results that match the
JSONPath Compliance Test Suite exactly.

## Terms
- **Engine:** `json-p3` 2.3.2 (MIT, no runtime dependencies, no `eval`), its default strict
  `JSONPathEnvironment` with the options in P6; it runs synchronously in the editor webview, as the
  library's own query languages do.
- **CTS:** the JSONPath Compliance Test Suite (`jsonpath-standard/jsonpath-compliance-test-suite`,
  BSD-2-Clause), `cts.json` at commit `9d1a415a53f5dfb291bc874823892e49174e38eb` (706 tests),
  vendored as test data.
- **Nodelist:** what an RFC 9535 query selects: the values it matched, each with its location.
- **Threshold:** spec 008's 5 MiB (5,242,880 bytes of UTF-8 text, UNK-014), measured as the
  document text's UTF-8 length when the Transform dialog opens (as 010 criterion 10 and 011
  criterion 11 do).

## Acceptance criterion (falsifiable)
`jsonpathRfc9535QueryLanguage` in `packages/app-shell` is a library `QueryLanguage` whose
`executeQuery(data, query)` returns the result (P2) or throws an `Error` whose message is shown in
the dialog's preview.

1. **Compliance (unit):** for every test in the vendored CTS, `executeQuery(document, selector)`
   returns exactly the test's `result` (or one of its `results`), compared with
   `isDeepStrictEqual` and key order checked; for every test with `invalid_selector: true` it
   throws. All 706 pass; none is skipped.
2. **Corpus (unit):** every case in `tests/query/jsonpath-rfc9535-<case>/` (`input.json5`,
   `case.json`, `query.jsonpath`, then `expected.json5` or `error.json`, the 011 corpus layout)
   gives data equal to `expected.json5` with key order checked, or an error whose message contains
   `error.json`'s text. Every `expected.json5` is written by hand from P1–P7.
3. **Coverage (unit):** the 011 coverage test, extended, asserts at least one RFC 9535 case per tag:
   `filter` and `pick` (wizard outputs, P7), `sort-refused`, `multi-pick-refused`, `child`,
   `wildcard`, `descendant`, `index`, `slice`, `union`, `function-length`, `function-count`,
   `function-match`, `function-search`, `function-value`, `nested-root`, `empty-result`,
   `syntax-error`, `type-error`, `unknown-function`, `bracket-name` (a key that needs bracket
   notation), `proto-key`, `minus-zero`, `nan`, `infinity`, `deep` (a descendant query on data
   nested deeper than 50 levels), `too-deep` (P6), and `goessner-only` (a query jsonpath-plus
   accepts that RFC 9535 rejects, such as `$..book[(@.length-1)]`).
4. **Exact values (fast-check, seed committed, 10 000 runs):** for any data the 002 formats can
   hold (JSON5 values, `-0`, `NaN`, `±Infinity`, duplicate-free objects with any keys including
   `__proto__`, nesting to depth 64): `$` gives `[data]`; `$.*` gives the data's array items or
   member values in order (`[]` for a scalar); `$..*` gives as many values as the data has
   descendants; every value in each result is `isDeepStrictEqual` to the value at its place in the
   data (P2).
5. **Dialog and wizard (web, `pnpm test:web`):** the Transform dialog lists "JSONPath (RFC 9535)"
   directly before "JSONPath (Goessner)", after JSONQuery and JMESPath; JSONQuery stays the
   default. (This amends 011 criterion 8's order: JSONQuery, JMESPath, JSONPath (RFC 9535),
   JSONPath (Goessner), JavaScript, Lodash, whichever of 011 T4 and 014 T3 merges first.) Its
   description names RFC 9535 and links to `https://www.rfc-editor.org/rfc/rfc9535`. Picking it
   and using the wizard's filter field, or the pick field with one field, fills the query box with
   P7's text and the preview shows its result; a sort field, or two or more pick fields, shows the
   library's JSONPath message under the wizard, and the query box keeps its last valid query, the
   preview that query's result and Transform stays enabled for it, as JSONPath (Goessner) does
   (amended in 014 T3, owner: Chris, thread decision card
   cmsg_01Wz9SKzwQD2da69nuNGPcidDFewF7MrBcpSgZ9b9uCHGf, 2026-10-13).
6. **Errors (web):** a syntax error (`$[?@.a`), a type error (`$[?length(@.*) < 3]`), an unknown
   function (`$[?foo(@)]`) each show their message in the preview, with the engine's position
   text; Transform is disabled; the document is unchanged. P6's too-deep message is proven by the
   unit corpus's `too-deep` case (criterion 2) only: in Chromium the library's Transform dialog
   cannot open on data deeper than about 130 levels (a stack overflow in its tree), so data past
   P6's 1,000-level limit never reaches the dialog (amended in 014 T3, owner: Chris, thread
   decision card cmsg_01Wz9SKzwQD2da69nuNGPcidQmzaokVg5YHK7y2A6YBWuw, 2026-10-13).
7. **Write-back (e2e):** Transform with JSONPath (RFC 9535) on
   `tests/e2e/fixtures/query/jsonpath-rfc9535-<case>/input.{json,jsonc,json5}` (the whole
   document in text, tree and table modes, and a selected node in tree mode) leaves the document
   text byte-equal to `expected.*`, written through the existing data-change path (002 R14, as 011
   Q5), so comments on surviving members stay; the document is dirty and not saved, and one undo
   restores the previous text exactly.
8. **Large files (e2e, per UNK-065 ★):** above the threshold the dialog does not list JSONPath
   (RFC 9535), in a large-file tab unlocked with "Edit anyway" (008 criterion 4) and in a normal
   tab whose text has grown past 5 MiB alike; at or below it, it is listed, also in an unlocked
   large-file tab whose text has shrunk. A locked tab offers no Transform at all (008 criterion 2).
9. **Offline, CSP and web build:** no CSP changes (the engine is plain JavaScript; no
   `'unsafe-eval'`, nothing beyond 011's `'wasm-unsafe-eval'`); no Node API in the webview or core;
   `pnpm check:offline` passes, with the description's RFC link added to `offline-allowlist.txt`
   by name with the Reviewer's sign-off (AGENTS rule 3). Once spec 013 is merged, its web
   extension build bundles the same code and its web test lists the language.
10. **Speed (bench):** `bench/RESULTS.md`, regenerated in one run, gives the median time of the
    bench queries (`bench/query/jsonpath-*.jsonpath`: a filter, a descendant search, a filter with
    `match` and a pick) at 1 and 5 MiB for JSONPath (RFC 9535) beside JSONPath (Goessner).
    HYPOTHESIS (sandbox check, Node 22, json-p3 2.3.2): at 5 MiB a filter takes about 0.05 s
    (Goessner 0.1 s) and `$..city` about 0.47 s (Goessner 0.15 s). If a bench query at 5 MiB
    exceeds 1 s on the CI runner, an UNKNOWN goes to the owner before T4 merges.
11. **Licenses:** `json-p3` at exactly 2.3.2 (MIT) is a runtime dependency of `app-shell`;
    `pnpm check:licenses` passes and `THIRD_PARTY_LICENSES.md` lists it.

## Query rules (the corpus encodes these)
- **P1 Language:** RFC 9535 exactly, as the engine's strict environment parses it: the five
  standard functions and no extensions (no `~` keys selector, no `#` current key, no script
  expressions, no `^` parent). Where RFC 9535 leaves an order open (members of an object under `*`
  and `..`), the result follows the data's own member order.
- **P2 Result:** the result is a JSON array of the nodelist's values, in nodelist order; `[]` when
  nothing matches. This is the shape the Goessner language already gives Transform (`$.a.b` on
  `{"a":{"b":1}}` gives `[1]`). Each value is the data's own value, unchanged: `-0`, `NaN`,
  `±Infinity` and own `__proto__` keys are kept. A name selects only an own member: `$.__proto__`
  selects a member named `__proto__`, and `$.constructor` on `{}` selects nothing.
- **P3 Root:** `$` is the whole document, or the selected node for a query on a selected node.
- **P4 Comparisons:** RFC 9535 §2.3.5.2.2. `-0` equals `0`. `NaN` and `±Infinity`, which JSON5
  can hold and the RFC's data model cannot, compare as JavaScript numbers do: `NaN` equals nothing,
  itself included; `-Infinity < 0`.
- **P5 Regular expressions:** `match` and `search` take an I-Regexp (RFC 9485); a pattern that is
  not one makes the function false (RFC 9535 §2.4.6–2.4.7). There is no time limit: a pattern with
  catastrophic backtracking stalls the page until it finishes, exactly as JSONQuery's `regex` does
  in v1 (sandbox check: `(a+)+` on 28 `a`s and a `b` takes about 15 s in both).
- **P6 Nesting:** the engine's recursion limit is 1,000 levels (its default of 50 would refuse a
  `..` query on ordinary deep data). Deeper data, or a JavaScript stack overflow while querying,
  gives the error "The data is nested too deeply for this query." instead of an engine error.
- **P7 Wizard:** the query text is the library's `jsonpathQueryLanguage.createQuery` text, which is
  already valid RFC 9535 (`$[?(@.age > 4)]`, `$[?(@["a b"] == 1)]`, `$[*].name`): the parentheses
  are an RFC 9535 parenthesized expression. Sort and multi-field pick give the library's own
  messages ("Sorting is not supported by JSONPath. Please clear the sorting fields", "Picking
  multiple fields is not supported by JSONPath. Please select only one field"). A field name RFC
  9535 cannot write (one with a lone surrogate) gives the engine's syntax error in the preview.

## Where we differ
- jsoneditoronline.org offers no JSONPath at all ("two query languages: JMESPath and JavaScript
  with Lodash", features page); the library under it offers Goessner's. We offer both, labelled.
- RFC 9535 and Goessner differ on purpose; the corpus tags the main differences (`goessner-only`)
  and the README's query section (spec 005) names them.
- Above 5 MiB we offer JSONPath (Goessner) and not RFC 9535 (UNK-065 ★).

## Scope
- **In:** the RFC 9535 `QueryLanguage` in `app-shell` (the engine with P6's options, P2 result,
  error mapping, the library's `createQuery`), its place in the dialog, the large-file rule, the
  vendored CTS and its test, the corpus and coverage tags, the property suite, the web tests, the
  e2e write-back fixtures, the bench, licenses and the allowlist entry.
- **Out:** removing or changing JSONPath (Goessner); copying a node's path as an RFC 9535
  normalized path or editing the breadcrumb as JSONPath (018); JSONPath in other places than
  Transform (search, schema, CSV row source); remembering the last language (019); a time limit on
  native queries; function extensions; lossless big numbers (015); the Chrome app (020), which
  reuses the app-shell language list.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md:80` (RFC 9535 row: "The library's JSONPath
  (jsonpath-plus) follows the older Goessner syntax, which differs in places; label it as such or
  add an RFC 9535 engine later"), `:112` (P2 "RFC 9535 JSONPath engine alongside the library's
  Goessner-style one"); `docs/research/architecture.md:71` ("added as an extra query language");
  `spec/DECISIONS.md` ADR-005; `spec/INDEX.md` P2 backlog item 014.
- Today: `packages/app-shell/src/App.svelte:75-82` (`QUERY_LANGUAGES`: JSONQuery, JMESPath,
  `{ ...jsonpathQueryLanguage, name: 'JSONPath (Goessner)' }`); spec 011 criterion 8 (the list
  with JavaScript and Lodash) and criterion 11 (above 5 MiB the native languages only); spec 008
  criteria 2 and 4; `tests/query/README.md` (the 011 corpus layout and coverage test).
- Site: jsoneditoronline.org/features/ (fetched 2026-10-11): "The tool support two query
  languages: JMESPath and JavaScript with Lodash"; JSONPath is not mentioned.
- Library (`vanilla-jsoneditor` 3.13.0, run in Node 2026-10-11): `jsonpathQueryLanguage.createQuery`
  gives `$[?(@.age > 4)]`, `$[?(@["a b"] == 1)]`, `$[?(@["it's"] == 4)]`, `$[?(@.s == "q")]`,
  `$[*]["a b"]`, `$[*].n`; each parses in json-p3 and gives the same result as jsonpath-plus. Sort
  and two-field pick throw the two messages quoted in P7. `executeQuery` returns an array of values
  (`$.a.b` → `[1]`, `$.zz` → `[]`).
- Engine choice (sandbox check 2026-10-11, Node 22, CTS commit `9d1a415`, 706 tests): `json-p3`
  2.3.2 passes 706/706; `jsonpath-js` 0.3.1 686/706 (function well-typedness); `jsonpath-rfc9535`
  1.3.0 (Apache-2.0) 665/706 (consecutive `&&`, index bounds). `@jsonjoy.com/json-path` was not
  tried: it depends on `@jsonjoy.com/codegen`, which compiles queries with `new Function`, refused
  by the webview CSP (ADR-006). json-p3: MIT, no runtime dependencies at 2.3.2 (`iregexp-check` is
  bundled), no `eval` or `new Function`, no imports in `dist/json-p3.esm.js`, no URL in the
  minified build, 60 KB minified; default `strict: true`; default `maxRecursionDepth` 50
  (`$..a` on 200 levels throws `JSONPathRecursionLimitError`), and with no limit 1,000 levels
  work and 5,000 overflow the stack (`RangeError`). npm: 2.3.2 published 2026-09-22; 3.0.0
  (2026-10-02) and 3.0.1 (2026-10-09) are a new major line under two weeks old, so 2.3.2 is
  pinned and an upgrade is its own PR that re-runs criteria 1–4.
- Engine behavior (same check): `$.__proto__` on a JSON-parsed own `__proto__` key gives its value;
  `$.constructor` and `$.toString` on `{}` give `[]`; `$[?@ == -0]` on `[0,-0]` gives both;
  `$[?@.n == @.n]` with `n: NaN` gives `[]`; errors carry the position (`unbalanced brackets
  ('$[?@.a':1)`, `length() argument 0 must be of ValueType`, `no such function 'foo'`).
- Speed (same check, generated records ~110 bytes each, median of 3): filter `$[?@.age > 40]`
  15 / 54 / 595 ms at 1 / 5 / 50 MiB (Goessner 104 / 1,260 ms at 5 / 50, JSONQuery 7 / 60);
  `$..city` 119 / 469 / 4,877 ms (Goessner 153 / 1,394 at 5 / 50); filter with `match` 29 / 130 /
  1,343 ms. Catastrophic `match(@, "(a+)+")` on 28 `a`s and a `b`: 15.0 s; JSONQuery's
  `regex(get(), "^(a+)+$")` on the same string: 15.2 s.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-065 | Whether JSONPath (RFC 9535) is offered above 5 MiB | criterion 8; T4 | resolved (owner): not above 5 MiB |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
