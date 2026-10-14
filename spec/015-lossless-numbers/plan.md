# PLAN 015 — Lossless big numbers

> Derives from spec `015`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Big numbers become lossless-json `LosslessNumber` values in data (ADR-014); every other number stays
a JavaScript `number`. The text side already keeps number tokens (002's style-preserving edits), so
the work is on the data side: read big numbers exactly, write them exactly, and compare them by
value. Using lossless-json's own class (not a look-alike) means `vanilla-jsoneditor` already
recognizes it as a number through `parser.stringify` (`typeUtils.ts:109-147`), and the site's
semantics (`valueOf`, `toString`) come for free.

**Core (`packages/core`):**
- **Reading (B1):** one helper `numberValue(tokenText, format)` returns `Number(text)` when
  `isSafeNumber(decimalText)` and a `LosslessNumber` otherwise. It is called only for tokens that
  could be big: length above 15 characters, or holding `e`/`E` (a token of at most 15 characters
  with no exponent has at most 15 significant digits, which a float always round-trips), so plain
  documents pay one length check per number. Called from `visitData` (jsonc-parser's
  `onLiteralValue` gives offset and length), the tree builder, the JSON5 parser's number branch
  (hex via `BigInt`, as `convert.ts:246` does), `parseData` and the `jsonl` adapter. `parseData`'s
  and `jsonl`'s `JSON.parse` fast path stays for text with no big-number candidate (R1).
- **Writing (B2):** the value writers (`jsonc-adapter.ts:130-137`, `json5-adapter.ts:265-273`,
  `stringify.ts:263-267`, `jsonl` items) write a `LosslessNumber` as `value` and a `BigInt` as
  `toString()`. `copy` already takes its value from `dataOf`, which B1 makes exact.
- **Equality and order (B3):** one `compareNumbers(a, b)` on exact values (lossless-json
  `compareNumber` on decimal texts, plain numbers through `String(n)` when the other side is big;
  `-0`/`0` and `NaN` kept as 007 says) used by `diff`'s keys (`diff.ts:274-275`, a big number keys
  by a normalized exact-value string), `test` (`edit.ts:577-597`) and `sort`
  (`actions.ts:177`, `:328-335`). `isPlainObject`-style checks treat a `LosslessNumber` as a scalar.
- **CSV (B9):** `jsonToCsv` writes a `LosslessNumber`'s `value`; `csvToJson` per UNK-067; quoted
  container cells read with core's parser instead of `JSON.parse`.

**Webview (`packages/app-shell`):**
- `parser.ts`: strict JSON keeps `JSON.parse` when a pre-scan finds no big-number candidate (core's
  `mayHoldBigNumber`, a scan of number-token shapes, T1 REPORT §3; the regex first planned here, a
  run of 16 digits or dots or a long exponent anywhere, flagged every bench text, plain ones
  included, so it never kept the fast path); a text with one goes through lossless-json's `parse` (`readJsonExact`, several times
  faster than core's parse; a `__proto__` key or a duplicate key falls back to core), and anything
  not strict JSON to core. Big numbers in the page's data are `EditorNumber`s, `LosslessNumber`s
  whose `valueOf` does not throw on `1e400` (the library's sorts call it). `stringify` is core's
  `jsonText` (lossless-json's duck-types `isLosslessNumber`, so a look-alike object would be
  written as a number). The library's `validationParser` gives Ajv's input nearest numbers (B6).
- `data-change.ts` `keyOf` writes big numbers by exact value (B3).
- Sort: the library has no hook for either sort (`onSortModal` is not a prop of the root editor,
  T1 REPORT §4), so the app records what the user asked for (the array, property and direction,
  from the sort dialog's Sort button or the table header clicked, in the nested editor too) and,
  when the library hands its sorted result over, re-sorts it with a stable B3 sort
  (`sort-order.ts`) before `dataChange`, which only needs the order. A sort in the nested editor
  applies on Apply; an edit made in it after the sort and before Apply keeps the library's order.
- Protocol (B5): patch values travel as JSON text written by core's `valueText` in a `valueText`
  field, read by core's B1 reader on the host, so a document object that looks like a
  `LosslessNumber` stays an object (only real `LosslessNumber` instances are numbers; `-0` is
  written as `-0`, and `NaN` and `Infinity` as tokens the reader refuses). `PROTOCOL_VERSION` is 15
  (T4). The app-shell page bundles import core rather than bundle it, so a page and its host
  adapter share one `LosslessNumber` class.
- Queries (B7): our `QUERY_LANGUAGES` wrap each library language's `executeQuery`: build a
  nearest-number map of the input's big numbers (nearest number → set of exact values), run the
  library on the rounded copy, then restore each result number per B7 or report the ambiguous count
  to the dialog's preview. JavaScript and Lodash (B8, UNK-066 ★): the 011 engine bridge encodes a
  big number as a marked value that the engine's prelude turns into a `LosslessNumber`-like class
  (QuickJS has `BigInt`), and decodes it back on the way out; a `BigInt` result is written as digits.

**Host (`packages/vscode-extension`):** Ajv gets data with big numbers turned into nearest numbers
(a walk over the parse, or `validationParser`'s `JSON.parse` of `stringify`; B6). Compare model,
convert and CSV already call core.

## Constraints / invariants
- Offline (AGENTS rule 3): lossless-json has no network code; `check:offline` stays green with no
  allowlist entry.
- Licenses (AGENTS rule 4): `lossless-json` 4.3.1 is MIT with no dependencies.
- Golden first (AGENTS rule 5): new cases only; no existing `expected.*` changes, because plain
  numbers behave exactly as today.
- Spec 008 criteria 6, 7, 11 keep passing (criterion 11 of this spec); spec 003/004/007 e2e stay
  green with no expected value changed except where §Changes to approved specs says.
- TypeScript 5.9.3; `engines.vscode` `^1.136.2`; nothing Node-only in shared code (ADR-013).
- Shared ledgers per AGENTS rule 9.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | The library works with `LosslessNumber` data | `spikes/lossless-numbers/REPORT.md`: tree/table render, inline edit, paste, copy, search, sort dialog and table header hooks, JMESPath/JSONQuery/JSONPath on rounded copies; parser costs at 5 and 50 MiB | R1–R4 answered |
| B | Core reads, writes and compares exactly | golden cases, property suite, bench rows | criteria 1–3, 10 (export), 11 (core part) |
| C | Editor, protocol and compare | e2e fixtures, protocol unit test | criteria 4–7 |
| D | Queries | query corpus cases | criteria 8, 9 |
| E | Large files, web, README | bench, web e2e case, UNK-068 | criteria 12, 13 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 The webview's `JSON.parse` fast path needs a scan that costs about one `JSON.parse` (spec §Current evidence) | Criterion 11 bounds it at 2× for plain JSON; T1 measures the regex against a char loop and, if both miss, uses `JSON.parse` with a source-reading reviver only on texts the scan flags |
| R2 The library mishandles a `LosslessNumber` somewhere (inline editor, table cell, enum or color detection) | T1 spike checks each view before T4; findings become T4 cases or a library-hook workaround |
| R3 B7's restore marks a coincidental computed value exact (a `sum` that equals a big id's nearest number) | That number is the big id's nearest number, so writing the id's digits is closer than JavaScript's; recorded in the corpus as `big-aggregate` |
| R4 Big ids colliding on one nearest number make B7 refuse a Transform | The message says so; JavaScript and Lodash (B8) keep digits without restoring, so the user has a way |
| R5 `diff` keying by exact value slows data-level actions | Plain numbers key as today. A big number keys as the plain number it equals when its exact value is that number's (`100000000000000000000` → the key of `1e20`; checked by comparing its exact value with that of `String(Number(text))`, the text a plain number's exact value is read from per spec §Terms; 015 T3), else by its normalized exact value (sign, digits without leading or trailing zeros, exponent), which no float key can equal. So plain `1e20` equals big `100000000000000000000`, and plain `9007199254740992.0` equals plain `9007199254740992` as today |
| R6 PRs #83 (protocol 12) and 012 T4 bump the protocol | T4 takes the next free version when it merges |

## Definition of Done
1. Criteria 1–14 green in CI; UNK-066, UNK-067 resolved by the owner, UNK-068 by its rule.
2. README states that big numbers keep their digits, with the large-file note if UNK-068 needs it.
