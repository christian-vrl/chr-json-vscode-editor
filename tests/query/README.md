# Query corpus (spec 011)

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
| `bigint-result`, `cyclic-result` | **Q2:** the result can't be written as JSON; the case has Q2's message |
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
