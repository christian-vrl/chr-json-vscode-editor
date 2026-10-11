# SPEC 009 — CSV import and export

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidFB6RA9PDp29NS9cLgGmgCF, 2026-10-09)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Spreadsheets, databases and many tools exchange tables as CSV, and users move data between those
tables and JSON. jsoneditoronline.org has "Import CSV" (Open menu) and "Export to CSV" (Save menu),
each a dialog with a header option, a delimiter, flattening of nested objects or arrays and a
preview; the feature map lists both as site-only and P1 ("CSV import and export, including from
table mode"). The editor library has neither, and v1 has no way to turn a CSV file into JSON or a
JSON array into CSV except by hand.

## Goal
The user exports a JSON, JSONC or JSON5 array of objects (the whole document, or the array shown in
table mode) to CSV, and imports a CSV file as JSON, choosing header, delimiter and flattening with a
live preview, entirely offline, and an exported document imports back to the same data.

## Terms
- **Row source:** the value being exported: per criterion 7, the document's data or a part of it.
- **Field name:** the CSV header text that names where a cell's value sits in a row object. A member
  of a nested object appends `.` and its key (`address.city`); an array item appends `[<index>]`
  (`tags[0]`). A key that is empty or contains `.`, `[`, `]` or `"` is written `["<key>"]` with the
  key as a JSON string, appended with no `.` before it (`["a.b"]` at the top level, `address["a.b"]`
  and `address[""]` when nested). This is the notation of csv42, the site's own CSV library
  (csv42 5.0.3 writes `a["x.y"]` and `a.b["c["]`).
- **Threshold** and **ceiling:** spec 008's 5 MiB threshold (UNK-014) and its 50 MiB ceiling.
- **Locked:** a CHR JSON editor tab in spec 008's read-only large-file mode that has not been
  unlocked with "Edit anyway" (UNK-040).

## Acceptance criterion (falsifiable)
`jsonToCsv(data, options)` in `packages/core` returns `{ text }` or `{ error }`, and
`csvToJson(text, options)` returns `{ data, warnings }` or `{ error }`; `warnings` and `error` carry
a message and, for import, a 1-based line number. Options and defaults are in §Options.

1. **Golden:** for every case in `tests/golden/csv/export/<case>/` (`input.json`, `options.json`,
   `expected.csv` or `error.json`), `jsonToCsv` gives `expected.csv` byte for byte, or the error in
   `error.json`; for every case in `tests/golden/csv/import/<case>/` (`input.csv`, `options.json`,
   `expected.json` and `warnings.json`, or `error.json`), `csvToJson`'s `data` deep-equals
   `expected.json` (`isDeepStrictEqual`, key order checked too) and `warnings` equals `warnings.json`,
   or the error equals `error.json`.
2. **Coverage:** each case's `case.json` lists the rules it exercises; a coverage test asserts at
   least one case per rule X1–X7 and I1–I7, a one-column table with a `null` row in each direction, one per value type of I7 (number, `true`, `false`,
   `null`, empty, JSON object or array, text), one per delimiter, and one with the header off for
   each direction.
3. **Round trip (fast-check, seed committed, 10 000 runs):** for `data` an array of objects that all
   have the same shape (the same keys, at least one, in the same order, at every level), with values
   that are scalars (strings, finite numbers other than `-0`, booleans, `null`) or non-empty objects
   of scalars, and for any delimiter, header on, either BOM
   setting and objects flattened or not, `csvToJson(jsonToCsv(data, o).text, { delimiter: o.delimiter })`
   has no warnings and `data` deep-equals the input. Strings whose text is a JSON object or array are
   excluded (I7 reads them back as that value). Keys are any strings, empty and dotted ones included.
4. **Import into a document (e2e, per UNK-042):** "Replace Document Data" applies `csvToJson`'s data
   to the open document as `diff(old, new)` → JSON Patch → `applyPatch` (002 R14) in one
   `WorkspaceEdit`: on `tests/csv/replace/*` the text equals `expected-after.*` byte for byte (comments
   on surviving members kept), the document is dirty, and one undo restores its text exactly.
5. **Commands (e2e):** "Export to CSV…" (palette; editor title of the CHR JSON editor and of the text
   editor for `json`, `jsonc` and `json5` documents) and "Import CSV…" (palette; editor title of the
   CHR JSON editor, which picks a `.csv` file in an open dialog) open the CSV panel (UNK-044);
   "Convert CSV to JSON" (explorer context menu and text-editor title on `.csv` files) opens it on
   that file. In the panel, "Save CSV…" writes `<name>.csv` beside the source, and "Create JSON File"
   writes `<name>.json` beside the CSV and opens it in the CHR JSON editor; when that file exists, a
   save dialog prefilled with its name picks where (as UNK-035 does for 006). "Copy CSV" puts the text
   on the clipboard. Closing the panel writes nothing. The source document and file are never changed,
   except by "Replace Document Data".
6. **Panel (web, `pnpm test:web`, other origins blocked):** the panel shows each option of §Options
   with its default, and a preview of the first 100 rows (export: the CSV text; import: the JSON in a
   read-only table) that reflects an option change within 500 ms. Warnings are listed under the
   preview; an error replaces the preview with its message and line, and disables every button that
   writes or copies.
7. **Row source (e2e):** "Export to CSV…" from table mode exports the array the table shows; from tree
   mode with exactly one array or object selected, that value; otherwise the document's data. The
   panel's title names the source's JSON Pointer when it is not the root. A document whose parse has
   an `error` diagnostic is not exported; the message says to fix it or run "Repair JSON" first, as
   006 criterion 7 does.
8. **Size (e2e):** a CSV file above the threshold imports in full; the preview still shows only the
   first 100 rows, and a created JSON file above the threshold opens as spec 008 says (large-file
   mode); one above the ceiling is still written, and opening it shows 008 criterion 9's message. A CSV
   file above the ceiling is not read: the message says the file is too large for CSV import.
9. **CSP, offline, theme:** the panel's webview CSP meets spec 003 criterion 6; `pnpm check:offline`
   passes with no new URL; no new runtime dependency; the panel passes axe-core's `color-contrast`
   rule with `tests/themes/{light,dark,hc}.json`.
10. **Large-file mode (e2e):** in a locked tab, "Import CSV…" is not offered (editor title and
    palette) and the panel offers no "Replace Document Data"; both come back after "Edit anyway".
    "Export to CSV…" and "Convert CSV to JSON" stay available. Export from a locked tab reads the data
    with 008's `parseData`, so core's parse cache holds no parse of the document afterwards (008
    criterion 8's test hook); an unlocked tab exports like any other.

## Options
| Option | Applies to | Values | Default |
|---|---|---|---|
| Delimiter | both | `,` `;` tab `\|`, and for import "Detect" | export `,`; import Detect (I3) |
| Header row | both | on, off | on |
| Flatten nested objects | export | on, off | on |
| Flatten nested arrays | export | on, off | off |
| UTF-8 BOM (for Excel) | export | on, off | off |
| Nested objects from field names | import | on, off | on |

## Export rules (golden cases encode these)
- **X1 Rows:** an array row source gives one row per item, in order; an object gives one row; any
  other value is an error ("CSV export needs an array or an object").
- **X2 Columns:** the union of the rows' field names in order of first appearance, row by row and
  member by member. An item that is not an object puts its value in a column whose field name is
  empty. A row with no value for a column gets an empty cell.
- **X3 Objects:** with "Flatten nested objects" on, a non-empty nested object is spread over one
  column per member, recursively, named per §Terms; off, it is one cell holding its JSON text. An
  empty object or array is one cell `{}` or `[]` in its own column, never dropped.
- **X4 Arrays:** with "Flatten nested arrays" on, a non-empty array is spread over one column per
  item (`[0]`, `[1]`, …), recursively; off, it is one cell holding `JSON.stringify` of it.
- **X5 Cells:** a string as written; a finite number as `JSON.stringify` writes it; `NaN`,
  `Infinity` and `-Infinity` as those words; `true`, `false`; `null` and a missing value as an empty
  cell.
- **X6 Quoting (RFC 4180):** a cell is quoted, with each `"` doubled, when it contains the delimiter,
  `"`, CR or LF, starts or ends with white space, is an empty string, or is a string that I7 would
  read as a number, `true`, `false` or `null` (`"7"`, `"true"`, `"null"`), so it imports back as text.
  Nothing else is quoted. A string whose text is a JSON object or array cannot be told apart from a
  nested value on import (I7), so it comes back as that value; export does not warn about it.
- **X7 Layout:** the header row (when on) holds the field names, quoted by X6; every row ends with
  CR LF, the last included; a BOM is written first only when that option is on.

## Import rules (golden cases encode these)
- **I1 Text:** UTF-8; a leading BOM is removed.
- **I2 Records (RFC 4180, lenient):** fields split on the delimiter; a quoted field may hold the
  delimiter, line breaks and `""` for `"`; records end at CR LF, LF or CR; one final line ending ends
  the text, and each line before it is a record. An empty line is a record of one empty field: with
  exactly one field name it is a row (so a one-column `null` row written by X5 survives), with more
  than one it is skipped, which also drops trailing empty lines. A `"` inside an unquoted field is
  kept as text. Text after a closing quote, up to the next delimiter or line end, is appended to the
  field's value as written, with a warning naming the line. A quote left open at the end of the text
  is an error naming the line where it opened. A text with no records is an error ("The CSV file is empty").
- **I3 Detect delimiter:** the first of `,` `;` tab `|` that splits each of the first 10 records
  (outside quotes) into the same number of fields, at least 2; else `,`.
- **I4 Field names:** with the header on, the first record gives the field names; an empty name
  becomes `Field <n>` (n = 0-based column); then a repeated name, including a `Field <n>` that equals
  another column's name, gets `_1`, `_2`, … and a warning. With the header off, every column is
  named `Field <n>` and the first record is data.
- **I5 Nesting:** with "Nested objects from field names" on, a field name in §Terms notation builds
  nested objects and arrays (`address.city`, `tags[0]`, `["a.b"]`); a name that is not valid notation,
  or that conflicts with an earlier one (`a` then `a.b`), stays a flat key, with a warning for each
  conflict. Array indices missing below the highest one given (`tags[2]` without `tags[0]`) become
  `null`, as csv42 does. Off, every field name is a flat key.
- **I6 Rows:** each record becomes one object with its members in column order. A record with fewer
  fields than there are names leaves the missing members out; a record with more fields keeps the
  extra ones as `Field <n>` and gets a warning naming its line. The result is an array, empty when the
  text is only a header.
- **I7 Values (per UNK-043 ★ "Exact"):** a quoted cell is a string, except one whose text is a JSON
  object or array (`{…}`, `[…]`), which becomes that value. An unquoted cell becomes: a number when
  it is an RFC 8259 number and `JSON.stringify(Number(text)) === text` (so `42` and `-1.5` are numbers;
  `007`, `1.50`, `1e3` and `12345678901234567890` stay strings); `true`, `false` or `null` for those
  words; `null` when empty; the value of its JSON text when it starts with `{` or `[` and parses;
  otherwise the string as written.

## Scope
- **In:** `jsonToCsv` and `csvToJson` in `core` (our own code, csv42's notation), the golden
  corpus and property suite, the CSV panel page in `app-shell` with a dev host, the VS Code panel and
  its commands, save, copy, create file and replace document data, delimiter detection, the size
  limits, behavior in spec 008's large-file mode.
- **Out:** encodings other than UTF-8; other delimiters or quote characters; type inference beyond
  I7 (dates, locale decimals such as `1,5`); choosing, reordering or renaming columns; streaming
  parse; editing CSV files in place in the CHR JSON editor (a `.csv` file is never opened as a
  document there); numbers beyond double precision on export (spec 015); NDJSON (012); the vscode.dev
  build (013); the Chrome app (020, which may reuse the panel page).

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md` §What jsoneditoronline.org does (Convert row: "Import
  CSV to JSON, export JSON to CSV", site only), §Prioritized feature list (P1 "CSV import and export,
  including from table mode"); `docs/research/architecture.md` §Components (CSV row: "Ours (`core/convert`)").
- Site behavior: jsoneditoronline.org/docs/ (fetched 2026-10-09): "Import CSV" in the Open menu with
  header and delimiter options and "Nested objects" for dotted field names; "Export to CSV" in the Save
  menu with a preview, a header option and "flatten nested objects or arrays", then copy or save to disk.
  The site's library is csv42 (ISC, "developed specifically for" the site, per its README).
- csv42 5.0.3 behavior (run in a scratch package, 2026-10-09): dotted and `[n]` field names, `["a.b"]`
  for keys with a dot, `Field 0` names without a header, `_1` for repeated names, `\r\n` rows; its
  default value parser turns `007` into `7`, rounds `12345678901234567890`, keeps a leading BOM in the
  first field name, silently drops extra fields, and its export drops an empty nested object or array
  and throws on an object row source. Its `package.json` has no `license` field (the license is in
  `LICENSE.md`), so `scripts/check-licenses.mjs:37` (`licenseOf`) cannot evaluate it.
- Data-level writes keep comments: spec 002 R14; `diff` at `packages/core/src/diff.ts:24`;
  `FormatAdapter.applyPatch` (`packages/core/src/formats/types.ts:56-58`).
- New JSON text: `stringify(data, format, style)` at `packages/core/src/formats/stringify.ts:28`.
- New file beside the source, save dialog when it exists, open in the editor it came from: 006 T3,
  `packages/vscode-extension/src/convertCommand.ts:172-175, 208` (UNK-035).
- Broken-source message: `packages/vscode-extension/src/convertPlan.ts:68` (`brokenMessage`).
- Selection and table mode: `vanilla-jsoneditor@3.13.0/index.d.ts:513` (`onSelect`); HYPOTHESIS: in
  table mode, the path of a selected cell starts with the path of the array the table shows, followed
  by the row index; with nothing selected, the shown array is the root when the root is an array. T4
  verifies; if it cannot be read, table mode exports the document's data like tree mode.
- Host-agnostic UI: ADR-002; the single-document `HostAdapter` (`packages/app-shell/src/host-adapter.ts`)
  is not shaped for a panel without a document, so the CSV page gets its own interface (as 007 T3's
  compare page does).
- Threshold and ceiling: UNK-014 (5 MiB); spec 008 (PR #59) criteria 1 and 9. Locked tabs and
  `parseData`: 008 criteria 2, 4, 6 and 8; UNK-040 (owner, "Read-only, unlockable").
- CSP and offline: ADR-006, spec 003 criterion 6; theme capture: spec 003 criterion 7.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-042 | Where imported CSV data goes | criteria 4, 5; T4 | see ledger |
| UNK-043 | How cell text becomes JSON values | I7, X6, criterion 3; T1 | see ledger |
| UNK-044 | CSV panel with preview, or pick lists | criteria 5, 6; T3, T4 | see ledger |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
