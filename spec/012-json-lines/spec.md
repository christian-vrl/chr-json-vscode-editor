# SPEC 012 — JSON Lines (NDJSON)

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidSSJ1ADSxnkC8Ywoiqb5YNw, 2026-10-11)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Logs, data exports and machine-learning datasets are often JSON Lines files (also called NDJSON):
one JSON value per line, usually one object per record. The feature map lists "NDJSON / JSON Lines
viewing in table mode" as P1 (ours, size M), because an array of records is exactly what table mode
shows. Today CHR JSON Editor does not open `.jsonl` or `.ndjson` files, and a JSON Lines text opened
as JSON is a parse error. jsoneditoronline.org only handles it through repair, which turns the lines
into one JSON array ("replacing … newline delimited JSON", jsoneditoronline.org/docs/), so the file
can no longer be saved as JSON Lines.

## Goal
A `.jsonl` or `.ndjson` file opens in CHR JSON Editor as a table of its records, edits are written
back as one changed line per record with every other line kept byte for byte, and the user can
convert between JSON Lines and JSON, JSONC or JSON5, entirely offline.

## Terms
- **JSON Lines** (format id `jsonl`, shown as "JSON Lines"): the jsonlines.org format, which
  ndjson-spec 1.0 matches: UTF-8 text where each line holds one JSON value (RFC 8259).
- **Line:** the text up to and including an LF, or the text after the last LF when it is not empty.
  A CR directly before the LF belongs to the line ending. A leading BOM belongs to the first line and
  is never a value byte.
- **Blank line:** a line holding only spaces and tabs before its line ending.
- **Item:** the value on a non-blank line. Item `i` (0-based) is the `i`-th non-blank line's value.
- **Bad line:** a non-blank line whose text, spaces and tabs around it aside, is not exactly one
  RFC 8259 value (a value spread over several lines, two values on a line, a comment, JSON5 syntax,
  a lone CR inside the line).
- **Threshold**, **ceiling** and **locked:** as spec 008 (5 MiB, VS Code's 50 MB sync limit, a
  large-file tab not unlocked with "Edit anyway").

## Acceptance criterion (falsifiable)
`getAdapter('jsonl')` in `packages/core` is a `FormatAdapter` (AGENTS.md §Glossary) whose data is
the array of items and whose edits follow §Line rules.

1. **Golden:** for every case in `tests/golden/jsonl/<case>/`, `applyPatch(input, patch, 'jsonl')`
   is byte-equal to `expected.jsonl`, or throws the `PatchError` in `error.json`, and
   `parse(expected).data` deep-equals `immutable-json-patch`'s result on `parse(input).data` (as
   002 criteria 1–2). Parse cases (`input.jsonl` with `data.json` and `diagnostics.json`) give that
   data and those diagnostics.
2. **Coverage:** each case's `case.json` lists the rules it exercises; a coverage test asserts at
   least one case per rule L1–L10, per `op` (add, replace, remove, move, copy, test, test-fail) at
   item level and at a nested path, per line ending (LF, CRLF), with and without a final newline,
   with blank lines between, before and after items, with a BOM, and for an empty text.
3. **Property (fast-check, seed committed, 10 000 runs):** over generated JSON Lines texts (random
   values, blank lines, spaces and tabs around values, LF or CRLF, final newline or not) and random
   valid patches, 002 criterion 2 holds, and every line that holds no item the patch touches appears
   in the output byte-identical and in the same order. Over generated arrays `a` of JSON values,
   `parse(stringify(a, style)).data` deep-equals `a`.
4. **Detection:** `detect(path, languageId?, text?)` returns `jsonl` for languageId `jsonl` (VS
   Code's built-in "JSON Lines" language) and for the extensions `.jsonl` and `.ndjson`, with
   source `languageId` or `extension`; the content step never returns `jsonl`. This adds one entry to
   each of those two steps of spec 002 R11 and changes nothing else in R11.
5. **Convert (golden + property):** `convert(text, from, to)` (spec 006) also takes `jsonl` as
   `from` or `to`, per §Conversion rules, with cases in `tests/golden/convert/jsonl-to-<to>/` and
   `<from>-to-jsonl/` checked as 006 criterion 1. Over the generator of criterion 3,
   `parse(convert(t, 'jsonl', to).text, to).data` deep-equals `parse(t, 'jsonl').data` for each `to`,
   with no losses; over 006's generator restricted to arrays at the root, the same holds for
   `convert(t, from, 'jsonl')` except at each loss's path, which holds `null` (UNK-034).
6. **Open (e2e):** "Open in CHR JSON Editor" and "Open With… → CHR JSON Editor" open `.jsonl` and
   `.ndjson` files. The tab opens in Table mode; the mode buttons offer Table and Tree only; the
   format badge reads "JSON Lines" and the "Change Format" picker lists it (choosing it, or leaving
   it, re-parses without changing bytes, as 003 criterion 8). Sort, transform, search, copy and
   "Export to CSV…" are offered; text mode, format, compact, smart format (spec 010) and "Repair JSON"
   are not.
7. **Edit (e2e):** for the first 10 golden cases of criterion 1 in sorted path order, opening
   `input.jsonl` and applying `patch.json` through the webview leaves the document text byte-equal to
   `expected.jsonl`; the document is dirty, save writes those bytes, and one undo restores the
   previous text exactly. An external `WorkspaceEdit` appears in the webview's data and nothing is
   echoed back (003 criterion 2). Sort of the root array reorders whole lines, each line's bytes kept.
8. **Bad lines (e2e, web, per UNK-051):** a document with a bad line shows its items read-only, with
   a banner "Line `<n>` is not valid JSON (`<k>` bad lines)." naming the first bad line (1-based),
   with "Open as Text" (VS Code's text editor on the same document, cursor at the start of that line)
   and "Repair Lines" (L10, one undoable edit; a message names any line it could not repair). When an
   edit made elsewhere leaves no bad line, the banner goes and the tab becomes editable without
   reopening. A blank line is never bad.
9. **Convert commands (e2e):** "Convert to JSON Lines" runs from the palette and editor title of the
   CHR JSON editor and of the text editor for `json`, `jsonc` and `json5` documents, and "Convert to
   JSON / JSONC / JSON5" also run on `jsonl` documents (in both editors), as 006 criterion 6: no
   prompt without losses, the loss modal otherwise, the result in a new file beside the source per
   UNK-035 (`data.json` → `data.jsonl`; from JSON Lines, the target's extension), opened in the
   editor the command ran from. A source whose root is not an array is not converted to JSON Lines:
   the message reads "JSON Lines needs an array at the root." and nothing is written. A source with
   an `error` diagnostic (a bad line included) is not converted (006 criterion 7); for a JSON Lines
   source the message names "Repair Lines" instead of "Repair JSON", which JSON Lines tabs do not offer.
10. **Large files (e2e):** a JSON Lines document above the threshold opens in spec 008's large-file
    mode, in Table mode, with 008's banner, read-only and unlockable as 008 criteria 2–4 say; with a
    bad line, both banners show and "Edit anyway" does not unlock until no bad line is left.
    `parseData('jsonl', text)` meets 008 criterion 6 for `jsonl`, and a locked tab keeps no full
    parse in core's cache (008 criterion 8). Above the ceiling, 008 criterion 9's message applies.
11. **CSV (e2e):** in a JSON Lines tab, "Export to CSV…" takes its row source as 009 criterion 7
    says (table mode: the items), and "Import CSV…" → "Replace Document Data" replaces the items
    through 002 R14, so lines of items that did not change keep their bytes.
12. **Speed (core bench):** `bench/RESULTS.md`, regenerated in one run, adds `jsonl` rows for
    `parse`, `parseData` and one item-level edit at 1, 10 and 50 MiB on documents from
    `bench/generate.mjs` (one record per line). `parseData('jsonl')` at 50 MiB has a median time at
    most 1.25 times that of `parseData('json')` on the same records written as one JSON array in the
    same run (amended in 012 T2, Keep/Revert card cmsg_01Wz9SKzwQD2da69nuNGPcid1ZuknxEYDNVa2xTF6N4MrG:
    one `JSON.parse` per line costs a fixed overhead per line, 594 ms against 523 ms on the CI runner,
    and no exact block reading was faster; see plan R4).
13. **CSP, offline, theme:** the webview CSP is unchanged (003 criterion 6); `pnpm check:offline`
    passes with no new URL; no new runtime dependency; the bad-line banner passes axe-core's
    `color-contrast` rule with `tests/themes/{light,dark,hc}.json`.

## Line rules (golden cases encode these)
- **L1 Parse:** the data is the array of items in line order, `[]` when there is none (an empty file
  opens as an empty table, not an error). Blank lines are skipped and kept as written. Each bad line
  gives one `error` diagnostic, message `Line <n> is not valid JSON.`, spanning the line without its
  ending; the data then holds the items of the lines that are not bad. Duplicate keys and numbers
  beyond double precision read as in 002's `json` adapter. The tree is an `array` node over the
  whole text whose children are the items' nodes, with offsets into the whole text.
- **L2 Style:** `eol` is the first line ending in the text (`\n` when there is none); `finalNewline`
  is whether the text ends with a line ending (true for an empty text); the other `Style` fields are
  fixed (`indent: 0`, `quote: '"'`, no unquoted keys, no trailing commas).
- **L3 Add an item** (`add` at `/i` or `/-`): a new line `JSON.stringify(value)` + `eol` is inserted
  at the start of item `i`'s line; at `/-` (or `/<count>`) right after the last item's line ending.
  When the last item's line has no ending, `eol` is written before the new line, which then gets
  none (R10). On a text with no item, the new line goes after any blank lines, with `eol` + final
  newline per L2.
- **L4 Remove an item:** its line and line ending are removed; for the last line without an ending,
  the line ending before it is removed instead. Blank lines stay.
- **L5 Replace an item:** the value's bytes are replaced by `JSON.stringify(value)`; spaces and tabs
  around the value stay.
- **L6 Move and copy items:** `move` from `/i` to `/j` moves the whole line with its bytes; `copy`
  inserts a new line holding the source value's bytes, placed as L3.
- **L7 Nested paths** (`/i/…`): the operation applies to item `i`'s value as a one-line `json`
  document under spec 002's rules (R2, R3, R8, R9), so the line stays one line (verified for
  object and array adds and replaces of nested containers, see §Current evidence); a `move` or `copy`
  between items carries the value's bytes. No other line changes.
- **L8 Root:** `replace` (or `add`) at `""` with an array applies `diff(oldData, newData)` (002 R14),
  so lines of unchanged items keep their bytes; with any other value, and `remove` at `""`, it is a
  `PatchError` ("A JSON Lines document holds an array of items."). `test` compares as usual.
- **L9 Atomic, line endings:** 002 R9 (a failing operation leaves the text unchanged) and R10 (line
  endings and final newline as detected) hold; a text with a bad line refuses every operation with a
  `PatchError` naming the first bad line.
- **L10 Repair Lines** (`repairLines(text) → { text, unrepaired }` in core): each maximal run of
  consecutive bad lines is first read as one value; if the run's text is exactly one RFC 8259 value
  (a pretty-printed record), it becomes one line, written as 002 R12 compacts it (tokens kept). Else
  each bad line of the run is repaired alone by core's repair (002 T11 engine, `jsonrepair`); a
  result that is one value replaces the line, compacted the same way; any other line stays as it is
  and its 1-based number is listed in `unrepaired`. Line endings, blank lines and the other lines are
  unchanged.
- **Other `FormatAdapter` actions:** `stringify(data, style)` writes each item as `JSON.stringify` +
  `eol`, final newline per `style` (an empty array gives `""`), and throws a `TypeError` for data
  that is not an array or holds a non-finite number; `sort` of `""` reorders whole lines (002 R13,
  blank lines keep their place), nested sorts apply to one item as L7; `compact` compacts each item
  as 002 R12 (used by J2 and L10; the UI does not offer Compact for JSON Lines, criterion 6); `prettyPrint` throws a `PatchError` ("Format is not available for JSON Lines.").

## Conversion rules (golden cases encode these)
- **J1 JSON Lines → JSON, JSONC or JSON5:** `[` + `eol` + each item's value bytes, indented by two
  spaces, joined by `,` + `eol`, then `eol` + `]` + `eol` (`eol` from L2); `[]` + `eol` with no
  item. No losses (every item is RFC 8259, valid in all three targets). A leading BOM is kept.
- **J2 JSON, JSONC or JSON5 → JSON Lines:** the source's root must be an array (else the error of
  criterion 9). The text is first converted to `json` by 006 (C1–C7, whose losses are this
  conversion's losses), then each item of the root array is written on its own line as 002 R12
  compacts it (tokens kept, so numbers beyond double precision and escapes stay as written), lines
  joined and ended by the source's line ending; an empty array gives an empty text. Comments
  between items are comment losses (C5).

## Scope
- **In:** the `jsonl` format in `core` (adapter, detection, `parseData`, conversion both ways,
  `repairLines`), golden corpus and property suites, opening `.jsonl` and `.ndjson` files in the
  custom editor in Table mode, the bad-line banner and "Repair Lines", the convert commands, spec 008's
  large-file mode and spec 009's CSV panel on JSON Lines documents, the bench rows.
- **Out:** text mode inside the webview for JSON Lines (VS Code's text editor is the line editor;
  "Open as Text" is the way there); detecting JSON Lines from content in files with other extensions
  (the "Change Format" picker does it); other separators (JSON text sequences, RFC 7464, CR-only
  line endings); schema validation of items (a later spec: no settings key maps a schema to each
  line today, and 004 validates the whole document); compare of JSON Lines files (007 is not
  changed); streaming load past VS Code's ceiling; the vscode.dev build (013); the Chrome app (020).

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md` §Prioritized feature list (P1 "NDJSON / JSON Lines
  viewing in table mode", Ours, M); `spec/INDEX.md` P1 row 012.
- Site behavior: jsoneditoronline.org/docs/ and /features/ (fetched 2026-10-11) mention newline
  delimited JSON only under repair. `jsonrepair` 3.15.0 (already a core dependency,
  `packages/core/package.json:15`) turns `{"a":1}\n{"b":2}\n` into `[\n{"a":1},\n{"b":2}\n\n]`;
  it repairs `{"a":1` to `{"a":1}` and `{a:'x'}` to `{"a":"x"}`, and throws on `{"a":1} {"b":2}`
  (scratch run 2026-10-11).
- VS Code's built-in `json` extension contributes the language `jsonl` ("JSON Lines") for `.jsonl`
  and `.ndjson` (`extensions/json/package.json` in microsoft/vscode, fetched 2026-10-11).
- L7 basis: the `json` adapter keeps a one-line container on one line and writes new values like
  `JSON.stringify` (scratch run 2026-10-11): `{"a":1}` + add `/b` `{"x":[1,2],"y":"q\nr"}` →
  `{"a":1, "b": {"x":[1,2],"y":"q\nr"}}`; `{"a":1}` + replace `/a` `[1,{"k":2}]` → `{"a":[1,{"k":2}]}`;
  `[]` + add `/-` → `[{"k":2}]`. 002 R3 and R8.
- Format plumbing: `Format` union `packages/core/src/formats/types.ts:6`; `getAdapter`
  `packages/core/src/formats/adapters.ts:6`; detection `packages/core/src/detect.ts` (`FORMATS`, R11
  steps); picker list `packages/vscode-extension/src/formatBadge.ts:23`; editor selector and menu
  `when` clauses `packages/vscode-extension/package.json` (`*.json`, `*.jsonc`, `*.json5`,
  `resourceExtname =~ /^\.(json|jsonc|json5)$/`).
- Webview parse: `packages/app-shell/src/parser.ts:35-52` tries `JSON.parse` first; a one-line JSON
  Lines file is valid JSON whose data is the item, not `[item]`, so `jsonl` must skip that path.
- Conversion and where it writes: spec 006 C1–C7, `convert` in `packages/core/src/formats/convert.ts`;
  UNK-034 (`null`), UNK-035 (new file beside the source).
- Large files and CSV: spec 008 criteria 2–4, 6, 8, 9 (`parseData` from 008 T1); spec 009 criteria
  4, 7 and UNK-042.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-050 | How far JSON Lines support goes | whole spec | resolved (owner): own format |
| UNK-051 | What a document with bad lines does | L1, L9, L10; criterion 8; T1, T4 | resolved (owner): read-only till fixed |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
