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
- `parser.ts`: strict JSON keeps `JSON.parse` when a pre-scan finds no big-number candidate (a run
  of 16 digits or dots, or an exponent of 3 or more digits, anywhere in the text: a false positive
  in a string only costs the slower path); otherwise core's parse. `stringify` becomes
  lossless-json's `stringify` (writes `LosslessNumber`s as digits, `JSON.stringify` otherwise).
- `data-change.ts` `keyOf` writes big numbers by exact value (B3).
- Sort: the library's `onSortModal` hook (`index.d.ts:342`, `SortModalCallback.onSort`) lets the
  app run the sort itself with B3's comparator; the table header sort goes through the same path
  (T1 confirms both; if the header sort cannot be hooked, the app re-sorts the library's result
  with a stable B3 sort before `dataChange`, which only needs the order).
- Protocol (B5): patch values travel as JSON text written by lossless-json `stringify` in a
  `valueText` field, read by core's B1 reader on the host, so a document object that looks like a
  `LosslessNumber` stays an object (it is written as an object, `{"isLosslessNumber":true,…}`, by
  `stringify`, since only real `LosslessNumber` instances are numbers). `PROTOCOL_VERSION` takes the
  next free number when T4 merges (#83 takes 12, 012 T4 bumps too).
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
| R5 `diff` keying by exact value slows data-level actions | Keys are built only for big numbers; plain numbers key as today |
| R6 PRs #83 (protocol 12) and 012 T4 bump the protocol | T4 takes the next free version when it merges |

## Definition of Done
1. Criteria 1–14 green in CI; UNK-066, UNK-067 resolved by the owner, UNK-068 by its rule.
2. README states that big numbers keep their digits, with the large-file note if UNK-068 needs it.
