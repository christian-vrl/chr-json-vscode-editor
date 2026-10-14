# Query corpus (spec 011, spec 014)

One folder per case: `tests/query/<case>/` with `input.json5`, `case.json`, `query.js`, and either
`expected.json5` or `error.json`. A case passes when `runQuery(language, data, query)` (011 T3) gives
data equal to `expected.json5` under `isDeepStrictEqual` with key order checked, or throws a
`QueryError` whose message contains `error.json`'s `message` (criterion 1). Every `expected.json5`
and `error.json` was written by hand from rules Q1–Q5 of `spec/011-js-queries/spec.md`, never
produced by the code under test, and changes only with a spec change (`AGENTS.md` rule 5).

`data` is `input.json5` read with the `json5` package (which keeps `-0`, `NaN`, `±Infinity` and a
`__proto__` key as an own key), or the node at `case.json`'s `path` for a query on a selected node.
`query.js` is the query text exactly as the Transform dialog's query box would hold it.

`sealed/` is not a case: it holds criterion 4's queries (011 T4), which `tests/web/query.spec.ts` runs
in the standalone page's Transform dialog in both languages; every value of their result must be
`"undefined"`. The loader skips it.
`jsonpath-cts/` is not a case either: it holds the vendored JSONPath Compliance Test Suite (below).

JSONPath (RFC 9535) cases (spec 014) and the big-number cases of every language (spec 015) are
described in their own sections below; the rest of this file up to there is about the JavaScript and
Lodash cases.

## Commands

| Command | Runs |
|---|---|
| `pnpm test:unit` | every test here, with the other unit tests (Vitest project `unit`) |
| `pnpm exec vitest run --project unit tests/query` | only the tests here |

## Tests here

- `query.ts` — the loader and the helpers. It rejects a case folder with a missing or stray file, or
  with both or neither of `expected.json5` and `error.json`. `referenceQuery` is the reference: the
  library's own `javascriptQueryLanguage` / `lodashQueryLanguage` `executeQuery` from
  `vanilla-jsoneditor` 3.13.0, run in Node, where `new Function` is allowed.
- `coverage.test.ts` — criterion 2: each tag below has a case in each language (`chain-without-value`
  in Lodash only); every case's `case.json` is well formed and its tags agree with its files; each
  wizard case's `query.js` is byte-equal to the library's `createQuery(data, wizard)` plus a final
  newline; `expected.json5` holds what its Q2 tag names (a `NaN`, an `±Infinity`, a `-0`, an own
  `__proto__` key, an ISO date string), and a `proto-key` input has an own `__proto__` key.
- `jsonpath-cts.test.ts` — spec 014 (014 T1): `jsonpath-cts/cts.json` is the pinned suite (its
  SHA-256 and commit in `SOURCE`, 706 tests, each well formed) and its licence is recorded.
- `jsonpath-rfc9535.test.ts` — spec 014 criteria 1 and 2 (014 T2): `jsonpathRfc9535QueryLanguage`
  gives every compliance test's result (or one of its results), key order checked, and throws for
  every invalid selector; it gives every RFC 9535 case's `expected.json5` or an error containing
  `error.json`'s text, and its `createQuery` throws the refused wizard cases' message.
- `library-languages.test.ts` — spec 015 criterion 8 (015 T5): the JSONQuery, JMESPath and JSONPath
  (Goessner) big-number cases, through `exactNumbersLanguage` (below).
- `reference.test.ts` — the reference half of criterion 1: every case without `error.json` and
  without a Q2 tag gives `expected.json5` in the reference, key order checked; every error case
  without a Q2 tag makes the reference throw, with `error.json`'s text unless the case is marked
  `engineMessage` (below).
- `run-query.test.ts` — the engine half of criterion 1 (011 T3): `runQuery` gives every case's
  `expected.json5`, key order checked, or a `QueryError` whose message contains `error.json`'s text.

## `case.json`

```json
{ "language": "lodash", "tags": ["nested-root"], "path": "/orders" }
```

- `language`: `javascript` or `lodash`. The case's folder name starts with it.
- `tags`: values from `tags.json`, the single vocabulary for these tests.
- `path` (with `nested-root` only): the JSON Pointer of the selected node the query runs on.
- `wizard` (with `filter`, `sort`, `pick` only): the library's `QueryLanguageOptions` — `filter`
  (`path`, `relation`, `value`), `sort` (`path`, `direction`), `projection` (`paths`). Each field set
  gives its tag (`projection` gives `pick`), and `query.js` is `createQuery`'s text for them.
- `engineMessage` (with `syntax-error` only): `error.json` holds the engine's own wording.

## Tags

| Tag | Meaning |
|---|---|
| `filter`, `sort`, `pick` | a wizard output (criterion 8): `query.js` is `createQuery`'s text for the case's `wizard` fields |
| `map` | a hand-written query that reshapes the data |
| `group` | grouping: Lodash `groupBy`; in JavaScript a `reduce` |
| `scalar-result` | the result is a number, string or boolean |
| `undefined-result` | the query returns `undefined`, which becomes `null` (Q2) |
| `nested-root` | a query on a selected node (`path`) |
| `shared-reference` | the result reaches one object twice without a cycle (reading 3) |
| `syntax-error`, `thrown-error`, `missing-query`, `chain-without-value` | the query fails (criterion 6); `chain-without-value` is Lodash's `_.chain(` without `.value()` |
| `nan`, `infinity`, `minus-zero`, `proto-key` | **Q2:** that value passes in and out exactly |
| `bigint-result` | **Q2** as amended by spec 015 B8: a `BigInt` in the result is written as its digits |
| `cyclic-result` | **Q2:** the result can't be written as JSON; the case has Q2's message |
| `date-result`, `function-result` | **Q2:** out of the engine the value follows `JSON.stringify` |

A case with one of the eight Q2 tags is left out of the reference comparison (criterion 1): the
library hands back a `Date`, a function, a `BigInt` or a cycle as it is, where `runQuery` follows Q2.
An error tag goes with `error.json` and the other tags with `expected.json5`; an error case has
exactly one error tag.

## Readings the corpus takes where Q1–Q5 leave a detail open

These are the corpus's reading of the spec, listed so a Reviewer can check each against Q1–Q5.

1. **Error text.** `error.json`'s `message` is a part of the error's message, so `runQuery` may add
   to it. A missing `query` function and a Lodash chain without `.value()` give the library's own
   messages (`Cannot execute query: expecting a function named 'query' but is undefined`,
   `Cannot execute query: Lodash _.chain(...) must end with .value()`), as plan step 1 and step 3
   say; a thrown error gives its own message.
2. **Syntax errors** are worded by the engine, QuickJS 0.32.0: `unexpected token in expression: '}'`.
   The reference (V8) says `Unexpected token '}'` for the same text, so these cases are marked
   `engineMessage` and the reference test only checks that it throws.
3. **A value reached twice without a cycle** is written twice, as `JSON.stringify` does; only a
   value that contains itself is Q2's "The result refers to itself."
4. **Members Q2 drops** sit in the `function-result` cases: a function, a symbol and an `undefined`
   member of an object are dropped, and in an array each becomes `null`.
5. **Key order** is JavaScript's: integer-like keys first in ascending order, then the others in
   insertion order (`javascript-map-key-order`). `expected.json5` is written in that order.
6. **Lodash and `__proto__`.** Lodash 4.18.1 skips a `__proto__` key in `_.pick`, `_.set` and its
   other path setters (its guard against prototype pollution), in the engine and in the reference
   alike. The `proto-key` cases use `_.mapValues`, which keeps the key.

The corpus avoids what the two engines do differently and the spec does not settle (plan R4):
`localeCompare` and `Intl` (QuickJS 0.32.0 has no `Intl`, and its `localeCompare` orders by code
unit: `['b', 'a', 'B', 'é', 'e']` sorts to `B, a, b, e, é` there and to `a, b, B, e, é` in Node 22),
`Date`'s `toString` and `toLocaleString`, the wording of `TypeError`s, a wizard `pick` of a field some
items lack (the reference keeps the `undefined` member that Q2 drops), and a result that is itself a
function (Q2 names members only). Q3 (scope) and Q4 (isolation of runs) are not cases: the reference
runs with Node's globals, and criterion 4 (011 T4) and 011 T3's unit tests check them.

## JSONPath (RFC 9535) cases (spec 014)

Folders `tests/query/jsonpath-rfc9535-<case>/` hold `input.json5`, `case.json`, `query.jsonpath` and
either `expected.json5` or `error.json`. Criterion 2: `jsonpathRfc9535QueryLanguage.executeQuery`
(014 T2) gives data equal to `expected.json5` with key order checked, or throws an error whose
message contains `error.json`'s `message`. Every `expected.json5` and `error.json` was written by
hand from P1–P7 of `spec/014-jsonpath-rfc9535/spec.md`, never produced by the code under test.

- **`query.jsonpath`** ends with one newline, which the loader takes off: RFC 9535 allows no
  whitespace after a query (the suite's `basic, no trailing whitespace` test), and the editors add a
  final newline. Any other trailing whitespace is a loader error.
- **`case.json`**: `language` is `jsonpath-rfc9535`; `tags` come from `tags.json`'s `rfc9535` list,
  each of which needs a case (criterion 3); `path` and `wizard` work as above. `engineMessage` is not
  used: there is no reference engine to word an error differently.
- **Wizard (P7):** `filter` and a `projection` of one path give `filter` and `pick`, and the query is
  the library's `jsonpathQueryLanguage.createQuery` text. A `sort` gives `sort-refused` and a
  `projection` of two or more paths `multi-pick-refused`: `createQuery` throws, so the case has no
  `query.jsonpath`, and `error.json` is that message exactly.

The coverage test also checks that a `bracket-name` query has a bracketed name selector, that a
`deep` input nests more than 50 levels (the engine's default limit) and less than 1,000 (P6), and
that a `too-deep` input nests more than 1,000. `reference.test.ts` runs no RFC 9535 engine
(`jsonpath-rfc9535.test.ts` does, below); it checks that each wizard case gives the same data in the library's JSONPath
(Goessner), as P7 says, and that Goessner accepts each `goessner-only` query.

### RFC 9535 tags

| Tag | Meaning |
|---|---|
| `filter`, `pick` | a wizard output (P7) |
| `sort-refused`, `multi-pick-refused` | a wizard sort, or two or more pick fields: the library's JSONPath message |
| `child`, `wildcard`, `descendant`, `index`, `slice`, `union` | that selector or segment |
| `function-length`, `-count`, `-match`, `-search`, `-value` | that RFC 9535 function in a filter |
| `nested-root` | a query on a selected node (`path`, P3) |
| `empty-result` | nothing matches: `[]` (P2) |
| `syntax-error`, `type-error`, `unknown-function` | the engine refuses the query (criterion 6) |
| `bracket-name` | a member name that needs bracket notation |
| `proto-key`, `minus-zero`, `nan`, `infinity` | P2 and P4: that value is kept and compared as the rules say |
| `deep` | a descendant query on data deeper than the engine's default limit of 50 |
| `too-deep` | data deeper than P6's 1,000 levels: P6's message |
| `goessner-only` | a query jsonpath-plus accepts and RFC 9535 rejects |

The error tags are `syntax-error`, `type-error`, `unknown-function`, `too-deep`, `goessner-only`,
`sort-refused` and `multi-pick-refused`; an error case has exactly one.

### Readings the corpus takes where P1–P7 leave a detail open

1. **Engine wording.** `syntax-error`, `type-error`, `unknown-function` and `goessner-only` cases
   hold json-p3 2.3.2's own text, as the spec's evidence quotes it (`unbalanced brackets
   ('$[?@.a':1)`, `length() argument 0 must be of ValueType`, `no such function 'foo'`) or, for
   `goessner-only`, the start of it (`unexpected token '('`). The type error's position text is left
   out: it quotes a window of the query, not a place a reader can use.
2. **Descendant order.** RFC 9535 lets `..` visit nodes depth first or breadth first, as long as
   each node comes before its descendants. The corpus avoids queries where the two orders differ
   (`$..author` matches only items of one array); P1 fixes object member order only.
3. **`NaN` with `!=`.** RFC 9535 defines `!=` as the negation of `==`, so with P4 (`NaN` equals
   nothing) `$[?@.n != @.n]` selects exactly the items whose `n` is `NaN` (`jsonpath-rfc9535-nan`).
4. **Names on arrays and inherited names.** A name selector selects only an object's own member
   (P2): `$.store.book.length` and `$.constructor` give `[]`.
5. **Depths.** `deep` uses 61 levels (60 objects around the leaf) and `too-deep` 100,001 (plan R5's
   60 and 100,000, plus the leaf object), both far from P6's 1,000.

## Big-number cases (spec 015)

Spec 015 criterion 8 adds cases for the library's query languages, each in its own folder
`tests/query/<language>-big-<case>/` with its own query file: `jsonquery` (`query.jsonquery`),
`jmespath` (`query.jmespath`), `jsonpath`, the library's JSONPath (Goessner) (`query.jsonpath`), and
`jsonpath-rfc9535`. Like `query.jsonpath`, each of these files ends with one newline, which the
loader takes off. Criterion 9 adds JavaScript and Lodash cases next to spec 011's. Every case carries
one of the `big-*` tags below, and tags.json lists the cells each language needs (`library` for
JSONQuery and JMESPath, `goessner` for JSONPath (Goessner), and the `big-*` entries of `rfc9535` and
`required`).

A big-number case's `input.json5` and `expected.json5` are read with core's JSON5 reader, so a
number with more digits than a float holds is a `LosslessNumber` (spec 015 B1) on both sides, and
the result must hold the same digits. Its expected data was written by hand from B7 and B8 of
`spec/015-lossless-numbers/spec.md`. `library-languages.test.ts` runs the JSONQuery, JMESPath and
JSONPath (Goessner) cases, `jsonpath-rfc9535.test.ts` the RFC 9535 ones, both through
`exactNumbersLanguage` (app-shell `query/exact-numbers.ts`) with the editor's parser, as the
Transform dialog runs them; `run-query.test.ts` runs the JavaScript and Lodash ones, and
`reference.test.ts` leaves them out (the library runs on rounded numbers).

| Tag | Meaning |
|---|---|
| `big-passthrough` | filtered, sorted, picked or selected big numbers come back with their digits (B7; B8 `filter`, `_.sortBy`, `map`) |
| `big-aggregate` | `max` of big ids is the big id (B7; JSONQuery and JMESPath) |
| `big-computed` | a number the query computes is written as JavaScript writes it (B7), or a `BigInt` as its digits (B8) |
| `big-ambiguous` | a result number rounds from two different exact values: B7's message, so Transform is disabled |
| `big-overflow` | `valueOf` of `1e400` or `-1E-400` throws lossless-json's message (B8) |
| `big-mixed` | a big integer's `BigInt` plus a number is the engine's `TypeError` (B8; `engineMessage`) |

### Readings

1. **No aggregate or computed number in JSONPath.** A JSONPath result (Goessner or RFC 9535) is
   always a list of nodes of the input, so it has no `max` and computes no number: those languages
   need `big-passthrough` and `big-ambiguous` cases only.
2. **"Written as JavaScript writes it."** A computed sum near 3.47 × 10^19 is the plain number
   JavaScript writes as `34700365001723880000`. core's reader would take that text for a big
   number, so `expected.json5` writes the same plain number as `3.470036500172388e19`.
3. **The message for one number** is "1 number in this result can't be kept exact." (B7's
   "`<n>` numbers …" with the noun in the singular).
4. **Numbers equal by exact value** count as one value (spec 015 §Terms): a big
   `100000000000000000000` next to a plain `1e20` is not ambiguous, and two spellings of one big id
   restore to the first one in the input.
5. **`1e400` in JSONQuery and JMESPath.** The library runs both on `JSON.parse` of its parser's
   text, where the nearest number `Infinity` is `null`, as before spec 015, so no case relies on it
   there; JSONPath (Goessner) and RFC 9535 see `Infinity` and restore `1e400`.

## JSONPath Compliance Test Suite (`jsonpath-cts/`)

`cts.json` and `LICENSE` are copied unchanged from
`https://github.com/jsonpath-standard/jsonpath-compliance-test-suite` at commit
`9d1a415a53f5dfb291bc874823892e49174e38eb` (BSD-2-Clause); `SOURCE` records the URL, the commit,
the file's SHA-256 and its 706 tests. It is test data, never fetched by a test and never shipped, so
`pnpm check:licenses` (shipped dependencies) and `pnpm check:offline` (build output) do not see it.
`.gitattributes` marks it `-text` so its bytes keep their hash. Criterion 1 (every test against the
engine) is `jsonpath-rfc9535.test.ts` (014 T2); updating the suite is its own PR with an engine check (plan R1).
