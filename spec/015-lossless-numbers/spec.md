# SPEC 015 — Lossless big numbers

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcid8rBEjWhoBBUYvqqGxPwYhU, 2026-10-12)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
JavaScript holds every number as a 64-bit float, which keeps about 15 to 17 significant digits.
A JSON file can hold more: database ids such as `12345678901234567890`, money or science values
with long decimals, and values such as `1e400` that are out of a float's range. Today CHR JSON
Editor keeps those digits in the file only while nobody touches them. Every edit path that goes
through data uses floats (sandbox probe on `main` @ d530253, §Current evidence):

- the tree and table show `12345678901234567000` for `12345678901234567890`, `0.1` for
  `0.1000000000000000000001` and `Infinity` for `1e400`, and copying a value copies those rounded
  digits;
- editing the value, `copy` in a patch, compare's "copy across" and CSV export write the rounded
  digits into the file;
- two different big ids compare as equal: compare shows no difference, sort leaves them in file
  order, and a JSON Patch `test` op passes against the wrong value.

jsoneditoronline.org fixed this by moving to its own lossless-json library: "all features of the
editor can work with large numbers" (§Current evidence). The feature map lists lossless big numbers
in the P2 backlog (`spec/INDEX.md`).

## Goal
A number with more digits than JavaScript can hold is shown, edited, copied, compared, sorted,
queried, converted, exported and saved with exactly the digits the file has, in every format and
host, while files with no such number open as fast as today.

## Terms
- **Big number:** a number token whose value JavaScript cannot hold exactly enough to write it
  back with the same digits. Precisely: lossless-json 4.3.1's `isSafeNumber(text)` is `false` for
  the token's decimal text (below), that is an integer outside ±(2^53 − 1), or a non-integer whose
  significant digits differ from the ones JavaScript writes for `Number(text)` (this includes
  overflow to `Infinity` and underflow to `0`). Examples: `12345678901234567890`,
  `9007199254740993`, `0.1000000000000000000001`, `123456789.123456789`, `1e400`, `1E-400`. Not big:
  `9007199254740991`, `4.0`, `1e2`, `-0`, `0.1`, `1.5e300`, `1.0000000000000002`.
- **Decimal text:** the token as written for an RFC 8259 number; for JSON5's other forms the text
  spec 006 C3 writes for it (hex as its exact decimal digits, sign kept, a leading `+` dropped,
  `.5` → `0.5`, `5.` → `5`). `Infinity` and `NaN` are not big numbers; they stay as today.
- **Big number value:** in data, a big number is a lossless-json `LosslessNumber` whose `value` is
  its decimal text (ADR-014). Every other number stays a JavaScript `number`, exactly as today
  (`4.0` is `4`, `-0` is `-0`).
- **Exact value:** the decimal value a number's text denotes. Two numbers are **equal** when their
  exact values are equal (`1e20`, `100000000000000000000` and `1.0e20` are equal), except that `-0`
  and `0` stay different and `NaN` equals `NaN`, as spec 007 criterion 1 says today.
- **Nearest number:** `Number(decimal text)`, the float JavaScript reads for a big number.
- **Size**, **threshold** and **ceiling:** as spec 008 (5 MiB = 5,242,880 bytes of UTF-8 text when
  the tab opens or the command runs).

## Rules (golden and unit cases encode these)
- **B1 Data:** wherever core builds data from text (`getAdapter(f).parse` data and tree node
  values, `parseData`, the four adapters including `jsonl`, `copy`'s source value, `test`'s current
  value), a big number becomes its big number value. Nothing else in the data changes.
- **B2 Writing:** wherever core writes a value as text (`applyPatch` `add`, `replace` and `copy`,
  `stringify`, 002 R15, `jsonl` items), a `LosslessNumber` is written as its `value`, unquoted, in
  every format (JSON5 included). A JavaScript `number` is written as 002 R8 says today. A `BigInt`
  is written as its decimal digits. Every byte outside the edited spans stays as written (002).
- **B3 Equality and order:** numbers compare by exact value (Terms), mixed `number` and
  `LosslessNumber` alike, in `diff` (and so compare, 002 R14 data-level actions and the webview's
  `dataChange`), the JSON Patch `test` op, `sort` (002 R13 and the order the webview sends), the
  library's sort dialog and table header sort, and compare's differences.
- **B4 Editor page:** the webview's parser gives the data core would (B1) and its `stringify`
  writes big numbers per B2. So the tree and table show a big number's decimal text, search finds
  it by its digits, a value typed or pasted with more digits than a float holds becomes a big
  number, and copy puts the exact digits on the clipboard.
- **B5 Messages:** a patch value, and any other document value a message carries, reaches the
  other side with its big numbers as big numbers, and an object in the document that happens to
  have `isLosslessNumber` and `value` members stays that object. The protocol version goes up.
- **B6 Schema validation:** Ajv validates data in which each big number is its nearest number, as
  today; validation errors are the same as on `main` for every existing fixture. A schema's own
  numbers are read the same way. (`maximum`, `multipleOf`, `enum` on big numbers stay approximate:
  §Out.)
- **B7 Library query languages** (JSONQuery, JMESPath, JSONPath Goessner, and RFC 9535 JSONPath
  from spec 014): the query runs on a copy of its input in which each big number is its nearest
  number, as today. In the result, a number is replaced by the big number it came from when its
  value is the nearest number of exactly one distinct big number of the input (by exact value) and
  of no plain number of the input; so selected, filtered, sorted, picked and grouped big numbers
  come back exact, and so does `max` of big ids. When a result number is the nearest number of two
  or more different big numbers (or of a big number and a plain one), the preview shows
  "`<n>` numbers in this result can't be kept exact." and Transform is disabled; nothing is written.
- **B8 JavaScript and Lodash queries (per UNK-066 ★ "Like the site"):** inside the QuickJS engine a
  big number is an object like lossless-json's `LosslessNumber`: `toString()` gives its decimal
  text, `valueOf()` gives the nearest number for a non-integer, a `BigInt` for an integer, and
  throws "Cannot safely convert to number: the value '`<text>`' would overflow/underflow…" for
  overflow and underflow (lossless-json's wording), so `<`, `>`, `+` and `_.sortBy` use its value. One
  returned unchanged keeps its digits; a `BigInt` in the result is written as its digits (B2),
  which replaces spec 011 Q2's "The result has a BigInt, which JSON can't hold." error.
- **B9 CSV export:** a big number is written as its decimal text, unquoted (adds to spec 009 X5).
  **CSV import (per UNK-067 ★ "Exact number"):** an unquoted cell that is an RFC 8259 number and a
  big number becomes that big number, its text kept; every other cell follows 009 I7 unchanged
  (`007`, `1.50` and `1e3` stay strings).
- **B10 Token actions:** format, compact, sort keys, smart format (010), convert (006), repair and
  JSON Lines actions keep number tokens as written today; big-number golden cases confirm it.

## Acceptance criterion (falsifiable)
1. **Golden (core):** `tests/golden/{json,jsonc,json5,jsonl}/` each gain cases tagged
   `special: big-number` covering, per format: `replace` and `add` of a big number value, `copy` of
   a member holding big numbers, a `test` that passes on an equal big number written differently
   (`1e20` vs `100000000000000000000`) and one that fails on `…890` vs `…891`, and (json5) a hex
   big number copied; each passes byte-equal under criterion 1 of spec 002. `patch.json` files are
   read with big numbers as big numbers (B1). Action cases (`compact`, `sort`, `format`,
   `data-diff`) and the convert corpus (006) each gain one big-number case, and the smart-format
   corpus (010) one when 010 T2 is on `main`.
2. **Data (core, fast-check, seed committed, 10 000 runs per format):** for documents whose numbers
   are drawn from a big-number generator (integers of 16–40 digits, decimals of 16–40 significant
   digits, exponents up to ±1000, mixed with plain numbers), `parse(text).data` and
   `parseData(format, text)` hold a `LosslessNumber` exactly where the text has a big number, with
   `value` equal to its decimal text, and a `number` equal to today's elsewhere;
   `parse(stringify(x, format, style)).data` equals `x` (spec 002 criterion 6 with big numbers),
   and spec 008 criterion 6 still holds.
3. **Equality and order (core unit + fast-check):** `diff(a, b)` is empty exactly when `a` and `b`
   are equal per Terms; `compare` reports `…890` vs `…891` as changed and `1e20` vs
   `100000000000000000000` as equal; `sort` orders `[1e400, -12345678901234567890, 5,
   12345678901234567891, 0.1000000000000000000001, 12345678901234567890, 0.1]` as `[-1234…890, 0.1,
   0.1000000000000000000001, 5, …890, …891, 1e400]`, and for random arrays of mixed numbers the
   order equals sorting their exact values with BigInt arithmetic.
4. **Editor (e2e):** on `tests/e2e/fixtures/big-numbers/input.{json,jsonc,json5,jsonl}`: the tree
   and table show every big number's decimal text (test hook reads the rendered cells); a `patch`
   setting `/a` to the typed text `98765432109876543210` leaves the document byte-equal to
   `expected-edit.*`; "Copy" on a big number puts its exact digits on the clipboard; search finds
   `12345678901234567890`; sorting the `ids` array ascending, by dialog and by table header, gives
   `expected-sort.*` byte for byte. Switching tree → text → table → tree leaves the bytes unchanged
   (spec 003 criterion 4).
5. **Messages (unit):** the protocol's encoder and decoder round-trip any patch whose values hold
   big numbers, plain numbers, `-0` and an object `{"isLosslessNumber": true, "value": "1"}`, each
   arriving as it left; a receiver built against the previous version rejects the new messages
   (version check).
6. **Compare (e2e):** comparing `tests/compare/big-numbers/{left,right}.json` shows exactly the
   differences in its `expected.json` (an id differing in the 20th digit is a difference), and
   copying one across writes its digits byte for byte (spec 007 criterion 6 fixture style).
7. **Validation unchanged (unit + e2e):** every spec 004 fixture gives the same errors as on the
   base commit; a schema `{"type": "integer"}` on `12345678901234567890` reports no error, and a
   big number does not make validation throw.
8. **Library queries (unit):** `tests/query/` gains cases per library language tagged
   `big-passthrough` (filter, sort, pick keep exact digits), `big-aggregate` (`max` restored),
   `big-computed` (a sum written as JavaScript writes it) and `big-ambiguous` (two big ids with the
   same nearest number in the result: the preview message, Transform disabled, no edit sent).
   RFC 9535 JSONPath gets its cases in whichever of 015 T5 and 014 T2 merges later.
9. **JavaScript and Lodash (unit + fast-check, per UNK-066):** spec 011 criterion 3's identity
   property holds over the big-number generator of criterion 2 (big numbers come back exact);
   corpus cases show `data.filter(d => d.id > 5)`, `_.sortBy(data, 'id')` and
   `data.map(d => d.id)` keeping big ids exact, `d.id + 1n` on a big integer written as its digits,
   and `d.big + 1` on `1e400` a `QueryError` with lossless-json's overflow message.
10. **CSV (golden):** `tests/golden/csv/` gains an export case (big numbers written as their digits,
    unquoted) and an import case per UNK-067; export then import of a document of big numbers gives
    the same data (009's round-trip property extended to big numbers).
11. **Speed (bench, one CI run):** `bench/RESULTS.md` adds a json document whose records hold
    19-digit ids. In the same run: the webview parser (`parserFor('json')`) on the 5 MiB json
    document without big numbers takes at most 2× `JSON.parse` of the same text, and on the 5 MiB
    big-id document at most 5×; spec 008 criteria 7 and 11 still pass; `parse` of each format at
    10 MiB is at most 1.1× of its time in the same run on the base commit (the bench job builds
    both).
12. **Large files (per UNK-068):** in a locked large-file tab, a big number shows its digits, if
    UNK-068's evidence allows (★); otherwise the banner adds "Numbers longer than 15 digits are
    shown rounded." and the tab shows nearest numbers. Either way the file's bytes never change.
13. **Web (web e2e):** the criterion 4 open-and-edit case runs in the web suite (spec 013) with the
    same expected bytes.
14. **Licenses and offline:** `lossless-json` at exactly 4.3.1 (MIT, no dependencies) is a runtime
    dependency of `core`; `pnpm check:licenses` and `pnpm check:offline` pass and
    `THIRD_PARTY_LICENSES.md` lists it.

## Where we differ from jsoneditoronline.org
- The site's lossless parser wraps every number, so it also shows `4.0` as written; ours wraps only
  big numbers, so `4.0` shows as `4` in the tree (the file keeps `4.0`, as today). Plain numbers
  stay plain, which keeps queries, sort and validation as they are and parsing fast.
- The site lets the user pick its parser (lossless up to 10 MB, native above). We have no setting
  (spec 019 may add one); large files follow UNK-068.
- The site's JMESPath and JSONQuery round big numbers in results; ours restore them (B7).

## Scope
- **In:** ADR-014 and the `lossless-json` dependency; B1–B3 in `core` (adapters, `parseData`,
  `applyPatch`, `stringify`, `diff`, `compare`, `sort`, CSV); the webview parser, `stringify`,
  `dataChange` and sort comparator; the protocol change; Ajv input conversion; the query rules B7
  and B8; the golden, property, query, CSV and e2e cases; the bench rows; the web e2e case; the
  README line on big numbers.
- **Out:** exact schema keywords on big numbers (`maximum`, `multipleOf`, `enum` compare nearest
  numbers, as Ajv does with floats); a parser setting (019); showing `4.0` as written; numbers in
  object keys (they are strings); arithmetic in JSONQuery, JMESPath or JSONPath on big numbers
  beyond the nearest number; the Chrome app (020, which gets this from `core` and `app-shell`).

## Current evidence (D2 — path + lines / section)
- Site: jsoneditoronline.org/indepth/parse/why-does-json-parse-corrupt-large-numbers/ (fetched
  2026-10-12): the editor "has integrated the lossless-json library and made sure that all features
  of the editor can work with large numbers"; a `LosslessNumber` "will be converted into either a
  Number or BigInt" when an operation needs a value, and "an error will be thrown when it is unsafe
  to do so". jsoneditoronline.org/docs/ (fetched 2026-10-12), Configuration → JSON parser: "Auto
  select" picks the Lossless JSON parser "for documents up to 10 MB"; the native parser "cannot
  handle long numbers like 18800000000000000123"; the lossless one "maintains the formatting of
  numbers like 4.0" and is slower, "noticeable for documents larger than 10 MB".
- lossless-json 4.3.1 (npm, MIT, no dependencies, 2026-07-31): `LosslessNumber` (`isLosslessNumber
  = true`, `value`, `valueOf()` → number, `BigInt`, or throws on overflow/underflow; no `toJSON`),
  `isSafeNumber`, `getUnsafeNumberReason`, `compareNumber` (exact, on decimal texts), `parse`,
  `stringify`. Sandbox check 2026-10-12 of `isSafeNumber`: `false` for `1152921504606846976`,
  `9007199254740993`, `0.1000000000000000000001`, `123456789.123456789`, `1e400`, `1E-400`; `true`
  for `4.0`, `1e2`, `-0`, `0.1`, `1.5e300`, `1.0000000000000002`.
- Library: `vanilla-jsoneditor@3.13.0` takes `parser` and `validationParser` (`index.d.ts:499-501`);
  its CHANGELOG says they exist "to support alternative JSON parsers like lossless-json". Its
  sources (`index.js.map`): `valueType` treats an object that `parser.stringify` writes as a number
  as a number (`src/lib/utils/typeUtils.ts:109-147`); validation re-reads data through
  `validationParser` when the two parsers differ (`src/lib/logic/validation.ts:94-102`); JSONQuery
  and JMESPath run on `JSON.parse(parser.stringify(json))`, rounding big numbers
  (`plugins/query/jsonQueryLanguage.ts:59-67`, `jmespathQueryLanguage.ts:101-111`); search and value
  rendering use `String(value)` (`logic/search.ts:163`, `utils/domUtils.ts:124`); its array sort
  orders by `typeof` first and compares two numbers with `>`/`<`, other values with
  `natural-compare-lite` (`logic/sort.ts:126-157`), so a `LosslessNumber` sorts after every
  `number`, and two of them sort by their text, not their value (B3 needs our comparator).
- Today's losses (sandbox probe on `main` @ d530253, built core, all four adapters):
  - data: jsonc-parser `Number(tokenValue)` (`jsonc-adapter.ts:34`, `:60-97`), JSON5
    `sign * Number(...)` (`json5-parser.ts:346-358`, hex through `Number`), `parseData`'s
    `JSON.parse` (`parse-data.ts:27`), `jsonl` `JSON.parse` per line (`jsonl-adapter.ts:64`). Parsed
    `{"a":12345678901234567890,"b":0.1000000000000000000001,"c":1e400}` gives `a:
    12345678901234567000, b: 0.1, c: Infinity` in every format.
  - writing: new values through `JSON.stringify` (`jsonc-adapter.ts:130-137`,
    `json5-adapter.ts:265-273`, `stringify.ts:263-267`); `copy` through `dataOf`
    (`edit.ts:558-574`, `643-645`) wrote `12345678901234567000`; `test` compares with `===`
    (`edit.ts:577-597`) and passed against the wrong value; `stringify` throws on `1e400` for
    json and jsonc.
  - order and equality: `diff`/`compare` key numbers as `` `d${x}` `` (`diff.ts:274-275`):
    `compare(…890, …891)` gave no difference; `sort` compares floats (`actions.ts:177`,
    `:328-335`) and left `[…891, …890]` unsorted; the webview's `reordering` keys with
    `JSON.stringify` (`data-change.ts:80-89`).
  - compare copy-across (`compareModel.ts:135-136`) wrote `{"a":12345678901234567000}`.
  - CSV: export writes `JSON.stringify(value)` (`csv/jsonToCsv.ts:119-121`); import keeps
    `12345678901234567890` a string (`csv/values.ts:3-10`, 009 I7), and a quoted JSON container
    cell goes through `JSON.parse` (`:27`), rounding.
  - webview: `parser.ts:54-92` (`JSON.parse` first, `JSON.stringify` for stringify); patch values
    are `JsonValue` (`protocol.ts:32`, `:131-144`), and the decoder accepts only plain objects
    (`protocol.ts:457`).
  - validation: Ajv gets `parse(text).data` (`vscode-extension/src/validation.ts:150-161`).
- Kept today (probe): every edit that does not write the number itself keeps its bytes:
  `applyPatch` on other keys, `move`, `compact`, `prettyPrint`, `sort`'s token moves, `convert`
  (hex converted exactly through `BigInt`, `convert.ts:246`), `repair`. FracturedJson 5.1.0 keeps
  number tokens (spec 010 §Current evidence).
- Cost (sandbox, Node 22.22.0, one 5.8 MiB array of records, median of 5): `JSON.parse` 46 ms;
  lossless-json `parse` 171 ms (every number wrapped) and 215 ms (only unsafe ones wrapped);
  `JSON.parse` with a reviver reading the source text 414 ms. A scan of an 8.8 MiB text for a run of
  16 digits or a 3-digit exponent takes 46–68 ms against `JSON.parse`'s 60 ms (regex or char loop),
  so a "no big number here" fast path costs about as much as `JSON.parse` itself (plan R1).
- Specs: 002 R8 (number writing), R13, R14; 006 C3, C7 (tokens kept, "number tokens beyond double
  precision"); 007 criterion 1 (equality `isDeepStrictEqual`, `-0` ≠ `0`, `NaN` = `NaN`); 008
  criteria 6, 7, 11; 009 X5, I7 ("numbers beyond double precision on export (spec 015)" out of
  009); 010 (tokens kept); 011 Q2 (BigInt result is an error), criterion 3, Out ("lossless big
  numbers (015)"); 012 ("numbers beyond double precision read as in 002's `json` adapter");
  013 (ADR-013: one package, web e2e); 014 (PR #89, approved, not merged: json-p3 runs on the
  webview's data; Out "lossless big numbers (015)").

## Changes to approved specs (AGENTS rule 7; approved with this spec on the approval card, which named each)
- **002 R8** "new numbers and strings are written as `JSON.stringify` would, except R4's quote
  character in JSON5" → adds "; a big number (spec 015) is written as its decimal text, and a
  `BigInt` as its digits".
- **007 criterion 1** equality "`isDeepStrictEqual`: key order ignored, `NaN` equals `NaN`, `-0`
  differs from `0`" → adds "numbers equal by exact value (spec 015 Terms)".
- **009 X5** "a finite number as `JSON.stringify` writes it" → adds "; a big number as its decimal
  text". **009 I7** (UNK-067 ★, owner, 2026-10-12): "`12345678901234567890` stay strings" → "an unquoted
  big number becomes that big number; `007`, `1.50` and `1e3` stay strings".
- **011 Q2** (UNK-066 ★, owner, 2026-10-12): "a `BigInt` … is a `QueryError` ("The result has a BigInt,
  which JSON can't hold.")" → "a `BigInt` is written as its digits"; criterion 2's
  `bigint-result` cases expect digits instead of that error.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-066 | What JavaScript and Lodash queries see for a big number | B8, criterion 9; T5 | resolved (owner): ★ Like the site |
| UNK-067 | What CSV import does with `12345678901234567890` | B9, criterion 10; T3 | resolved (owner): ★ Exact number |
| UNK-068 | Big numbers in large-file mode | criterion 12; T6 | delegated (T6 bench evidence) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
