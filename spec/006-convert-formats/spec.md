# SPEC 006 — Convert between JSON, JSONC and JSON5

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidVT5gy47SrYHitggeYZ7YQa, 2026-10-09)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
v1 reads and writes JSON, JSONC and JSON5, but a file stays in the format it was opened in. The
"Change Format" picker (003 criterion 8) only re-parses the same bytes as another format; it never
rewrites them. Users who move a config between tools (for example a JSON5 file that must become
strict JSON) rewrite it by hand today. The feature map lists conversion as P1: "Commands to convert
between JSON, JSONC and JSON5, warning when comments or `NaN`/`Infinity` would be lost going to
strict JSON".

## Goal
A command converts the active JSON, JSONC or JSON5 document to either of the other two formats,
changing only the tokens the target format cannot hold, and asks before any step that loses
comments or values.

## Acceptance criterion (falsifiable)
`convert(text, from, to)` in `packages/core` returns `{ text, losses }`, where `losses` lists each
comment and each value the target cannot hold, with its offset and length in the input (and the
JSON Pointer of the value for a value loss).

1. **Golden:** for every case in `tests/golden/convert/<from>-to-<to>/<case>/`, `convert(input, from, to).text`
   is byte-equal to `expected.<to-ext>`, and `losses` equals `losses.json` (`[{kind, offset, length, path?}]`, in input order).
2. **Coverage:** each case's `case.json` holds tags `{rules, location}`; a coverage test asserts at
   least one case per pair for every rule that rewrites bytes in that pair: `json5-to-json` C1–C6,
   `json5-to-jsonc` C1–C4 and C6, `jsonc-to-json` C5 and C6, each superset pair C7; and, for C1 and C3–C5,
   one case per `location` ∈ {root, nested-object, array}.
3. **Superset pairs keep every byte:** for `json-to-jsonc`, `json-to-json5` and `jsonc-to-json5`,
   `convert` returns the input text unchanged and no losses, over the 002 property generator
   (fast-check, seed committed, 10 000 runs per pair).
4. **Data:** for all six pairs over the property generator, `parse(out, to)` has no `error`
   diagnostic, and its data deep-equals `parse(input, from).data`, except at the `path` of each value
   loss, where it holds the value UNK-034 decides. For `to = json`, `strictJsonDiagnostics(out)` is empty.
5. **Kept bytes:** for every pair, every token of the input that C1–C6 do not name appears in the
   output byte-identical and in the same order; for `to` ∈ {jsonc, json5}, every comment does.
6. **Command (e2e):** "Convert to JSON / JSONC / JSON5" runs from the command palette and the
   editor-title menu, both in the CHR JSON editor and in the text editor. With no losses it writes the
   result as UNK-035 decides, with no prompt. With losses, a modal states how many comments are removed
   and which values change (by path); "Cancel" leaves every file and document byte-unchanged and
   creates no file.
7. **Broken source:** a document whose parse has an `error` diagnostic is not converted; the message
   says to fix it or run "Repair JSON" first, and no file or document changes.
8. **Offline:** no new URL in build output; `pnpm check:offline` stays green.

## Conversion rules (golden cases encode these)
Every token not named below is copied byte for byte (C7). Target `jsonc` keeps comments and
trailing commas (ADR-005: "the file's existing style kept on write").
- **C1 Strings:** a string token that is not a valid RFC 8259 string literal (single quotes, `\'`,
  `\x41`, `\v`, `\0`, line continuations, an unescaped control character) is replaced by
  `JSON.stringify` of its value. Valid ones are kept as written, escapes included. Applies to `to` ∈ {json, jsonc}.
- **C2 Keys:** an unquoted key, or a key whose string token fails C1's test, is replaced by
  `JSON.stringify(key)`. Applies to `to` ∈ {json, jsonc}.
- **C3 Numbers:** JSON5-only number syntax is rewritten without going through a float, so no digit
  changes: hexadecimal → its exact decimal digits (sign kept); a leading `+` is dropped; a leading
  `.` gets a `0` (`.5` → `0.5`); a trailing `.` is dropped (`5.` → `5`, `5.e3` → `5e3`). Applies to `to` ∈ {json, jsonc}.
- **C4 Non-finite numbers:** `Infinity`, `-Infinity`, `+Infinity` and `NaN` have no JSON or JSONC
  form. Each is a value loss, written as UNK-034 decides. Applies to `to` ∈ {json, jsonc}.
- **C5 Comments:** removed for `to = json`, each one a comment loss. White space before the comment
  on its line goes with it, and a line left blank by that is removed with its line ending.
- **C6 Trailing commas and white space:** for `to = json`, a trailing comma is removed (no loss: data
  is unchanged). For `to` ∈ {json, jsonc}, a JSON5-only white-space character (`\v`, `\f`, U+00A0,
  U+FEFF, other `Zs`) becomes one space, and U+2028 or U+2029 outside a
  string becomes the document's line ending.
- **C7 Everything else** is kept byte for byte, including number tokens beyond double precision,
  key order, duplicate keys, indentation and line endings.

## Scope
- **In:** `convert` in `core`, the three commands, the loss modal, writing the result per UNK-035,
  golden corpus and property suite.
- **Out:** reformatting or restyling during conversion (format and smart format are separate
  actions; to JSON5 no key is unquoted and no quote changes); YAML, TOML, XML and CSV (specs 017,
  009); NDJSON (012); changing the "Change Format" picker, which keeps re-parsing without rewriting.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md` §Formats and current specs ("Conversion" bullet) and
  §Prioritized feature list (P1 "Convert between JSON, JSONC and JSON5, warning on lossy steps").
- Format targets: ADR-005 (JSON strict on write; JSONC keeps the file's trailing-comma style; JSON5 1.0.0).
- Owner decisions that set the bar: comments are kept through whole-document actions (UNK-015,
  002 R12–R14); JSON5-only values are kept, not changed, when repairing (UNK-028).
- Token streams with offsets exist for all three formats: `packages/core/src/formats/tokens.ts:8-42`
  (`Kind`, `tokenize` on `jsonc-parser`'s scanner) and `packages/core/src/formats/json5-parser.ts:25-35`
  (`parseJson5` returns `tokens`, with `Unknown` for an unquoted key per `tokens.ts:4`).
- JSON5 white space the JSON grammar lacks: `json5-parser.ts:9-10` (`LINE_TERMINATOR` includes
  U+2028/U+2029; `WHITE_SPACE` includes `\v`, `\f`, U+00A0, U+FEFF, `\p{Zs}`).
- JSON5-only number forms: `json5-parser.ts:13-14` (`NUMBER`: sign, `Infinity`, `NaN`, hex, leading
  and trailing `.`).
- Strict JSON check: `packages/core/src/detect.ts:67-68` (`strictJsonDiagnostics`).
- `stringify(data, format, style)` (002 T7, `packages/core/src/formats/stringify.ts:1-20`) writes no
  comments and throws a `TypeError` on a non-finite number for JSON and JSONC; it is used only if
  UNK-033 picks re-stringifying.
- Existing commands and menus: `packages/vscode-extension/package.json:43-97` (`chrJsonEditor.*`,
  editor-title `when` clauses for the custom and text editors).

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-033 | Keep the file's layout and comments, or re-stringify | whole spec (C1–C7 follow its answer) | see ledger |
| UNK-034 | What `NaN` and `Infinity` become in JSON or JSONC | C4, T1 cases | see ledger |
| UNK-035 | Where the converted text goes | criterion 6, T3 | see ledger |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
