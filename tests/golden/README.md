# Golden corpus (spec 002)

One folder per case: `<format>/<case>/` with `input.<ext>`, `patch.json` (RFC 6902),
`expected.<ext>` and `case.json`. A case passes when `applyPatch(input, patch, format)` is byte-equal
to `expected` (criterion 1). Every `expected.*` was written by hand from rules R1–R10 and R15 of
`spec/002-formats-core/spec.md`, never produced by the code under test, and changes only with a spec
change (`AGENTS.md` rule 5). Line endings are kept as written (`.gitattributes`, `.editorconfig`).

## Commands

| Command | Runs |
|---|---|
| `pnpm test:golden` | every test in this folder |
| `pnpm test:golden -- --coverage-only` | only `coverage.test.ts` (criterion 4), `convert-coverage.test.ts` (spec 006 criterion 2) and `csv-coverage.test.ts` (spec 009 criterion 2) |
| `pnpm test:golden -- --format json,jsonc --op add,remove` | per-case tests for those cases only; fails if a named format, op, or (format, op) pair has no case; the conversion corpus tests still run |

Any other argument, or an unknown format or op, exits 2 before a test runs (`scripts/test-golden.mjs`).

## Tests here

- `load.test.ts` — the loader. It rejects folders under `tests/golden/` that are not a format and
  files directly inside a format folder.
- `actions.test.ts` — criterion 8 (002 T10): cases tagged `compact`, `sort` or `format` run
  through the format adapter's `compact` / `sort` / `prettyPrint`, are byte-equal to `expected`, and keep every input comment
  not listed in `removedComments`.
  `data-diff` cases (R14) apply `diff(parse(input).data, value)` with `applyPatch`. `apply.test.ts`
  skips these cases.
- `coverage.test.ts` — criterion 4: every case carries all seven tags with known values, and every
  grid cell has a case per format.
- `corpus.test.ts` — checks the hand-written bytes against references independent of our format
  code: `JSON5.parse(expected)` deep-equals `immutable-json-patch` applied to `JSON5.parse(input)`
  (criterion 2); a `test-fail` patch throws there and `expected` equals `input` (R9); `expected` keeps
  the input's line endings and final newline (R10; R15 cases on a text with no line break get `\n` and a final newline); `json` cases are strict JSON; each case's tags
  match its input and patch (`facts.ts`: op present in the patch, location derived from the path,
  comments present, trailing comma, and for json5 majority quote, key style and literal kind). For
  `compact` the data and its key order are unchanged and every comment is there, with `//` comments
  written as block comments; for `sort` the data equals the sort `vanilla-jsoneditor` 3.13.0 does
  (`sort-reference.ts`), with every comment kept; `compact` leaves no line break outside a string
  or block comment and keeps the final newline. For `format` (003 T8) the data, its key order and
  every comment, as written, are unchanged.

## Whole-document actions (R12–R14, criterion 8)

A case tagged `compact`, `sort`, `format` or `data-diff` holds one action in `patch.json` instead
of an RFC 6902 patch: `[{"op": "compact", "path": ""}]`, `[{"op": "format", "path": ""}]` (003 T8:
`prettyPrint`, the editor's Format), or `[{"op": "sort", "path": "<container>",
"property": "<pointer inside each item>", "direction": "asc" | "desc"}]` (`property` and
`direction` optional, as in `SortOptions`; or `"order": [<old index>, …]`, the order the editor's
own sort chose, 003 T8), or `[{"op": "data-diff", "path": "", "value": <new
data>, "removedComments": [...]}]`: the data a data-level action (transform, repair, compare,
CSV merge) produced, and the input comments attached to members it removes (R5, UNK-015), as
written; `corpus.test.ts` checks that expected parses to `value` and keeps every other comment.
`value` holds no `-0`, which R8 writes as `0`. Its `location` tag names where the action's container
is: `root` for the root container (`path` `""`) or a member of it, `nested-object` deeper.

## Tags (`case.json`)

Values come from `tags.json`, the single vocabulary for these tests and `scripts/test-golden.mjs`.

| Tag | Meaning |
|---|---|
| `op` | the patch's operation; `test-fail` is a patch whose `test` fails, so the result is an error and unchanged text (R9). A `test` case may follow its `test` with another op, and a `test-fail` case may put an op before the failing `test` to show atomicity. |
| `location` | where the patch `path` points (for `move`/`copy`, the destination): `root` = a member of the root container; `nested-object` = a member of an object inside the root; `array-start` / `array-middle` / `array-end` = index 0 / an inner index / the last index (or `-` for `add`) of an array. `document` = the pointer `""` on a text with no value (R15, UNK-026); it is outside criterion 4's grid, and its cases may have an empty input. |
| `comments` | comments on the member the op is about (UNK-008): `before` = comment line(s) above it (they travel with it on `remove`/`move` only when directly above, with no blank line between; `remove-root-comment-before-blank-line-stays` shows the other side); `after` = a comment at the end of its line; `inline` = a block comment inside its line after the member starts: between key and value, or after the value and before its comma (`"a": /* c */ 1`, `0 /* c */,`). `leading` = a block comment before the member on its line (`[80, /* tls */ 443]`, `/* old */ 0,`; reading 11); it is outside criterion 4's comments grid; `none` = no comment next to it. For `add` that member is the neighbor: the previous last member when appending, the member now at that index when inserting. For `move`/`copy` it is the `from` member. |
| `trailingComma` | whether the edited container has a trailing comma. Always `no` in `json`. |
| `quote` | the file's majority string quote. Always `double` in `json` and `jsonc`. |
| `keyStyle` | whether the file's keys are quoted or unquoted. Always `quoted` in `json` and `jsonc`. |
| `special` | a JSON5-only literal in the input: `hex`, `infinity-nan`, `multiline-string`, or `none`. Always `none` in `json` and `jsonc`. |

## Readings the corpus takes where R1–R10 leave a detail open

These are the corpus's reading of the spec, listed so a Reviewer can check each against R1–R10.

1. **Comma before a comment.** When a member that has a same-line comment gains a comma (it stops
   being last, or a member is appended after it), the comma goes right after its value, before the
   comment: `"b": 2 // two` becomes `"b": 2, // two`. Removing the last member removes the comma
   before the previous member's comment the same way.
2. **Inserting before a commented member** (UNK-022, owner: ★). A comment directly above a member belongs to it
   (UNK-008), so `add` at that member's index inserts above the comment.
3. **`move` moves text.** The moved member's value bytes are kept as written (R8: existing literals are
   never rewritten unless replaced), so `0x0A` stays `0x0A`. Carried comment lines take the new
   member's indentation (R1).
4. **`copy` does not copy comments** (UNK-023, owner: ★). Plan 002 defines `copy` as `add` of the value, and patch values
   are plain data.
5. **New containers.** A new object or array value in a multi-line container is written like
   `JSON.stringify(value, null, unit)`, indented from its member's line (R1).
6. **`move` to `""`** replaces the whole document with the moved value (RFC 6902 §4.4: remove at
   `from`, then `add` at the root), so every comment outside the root value's span stays.
7. **Carried comments on a shared line.** When `move` puts a member on a line with other members,
   its same-line comments follow its comma as block comments (`//` becomes `/* … */`, R12), with
   one space before the next member even after a bare `,`: `[3, /* three */ 1,2]`.
8. **Compact ends.** White space before the first token goes; a final newline stays as detected
   (R10), so compact output is one line plus that newline. Line breaks inside strings (a JSON5 line
   continuation) and block comments are bytes of those tokens and stay. A `.json` file with
   comments (a warning, not an error) keeps them as JSONC does.
9. **Sort order** is the library's: object keys in case-insensitive natural order
   (`natural-compare-lite`, `item9` before `item10`); array items by the value at `property`,
   booleans before numbers before strings before other values before missing ones; stable, so equal
   members keep their order in both directions. Only the named container is sorted. `property` is
   read from each item's own members, so an item lacking a key named like an `Object.prototype`
   member (`constructor`) counts as lacking it, where the library would read the prototype's.
10. **Sort slots.** When every member of the container sits on lines of its own, a member travels
    with the comment lines directly above it and its same-line comments (R5, UNK-008); otherwise
    it travels with its same-line comments only. The text between members (blank lines, comments
    attached to none) stays in place, between the same member positions. The member placed last
    loses or gains a comma so the container keeps or lacks its trailing comma (R6); a gained comma
    goes right after the value (reading 1). A `//` comment that no longer ends its line becomes a
    block comment (reading 7).
11. **Leading comments** (UNK-021, owner: ★). Block comments before a
    member on its line, with only white space between, belong to that member: `remove` and `move`
    take them with it (`move` keeps them before it, as written), `add` at its index inserts before
    them, and `sort` moves them with it. A block comment after a member's comma with a member after
    it on the line is the next member's, not part of the first one's same-line tail.

The corpus avoids details R1–R10 do not fix: a new container value inside a single-line container,
removing the only member of a container, a new key that is not identifier-safe in JSON5, a string
containing the file's quote character, and a `test` on an object whose keys are in a different
order (the reference `immutable-json-patch` 6.0.3 compares key order; RFC 6902 §4.6 does not).

## Conversion corpus (spec 006)

`convert/<from>-to-<to>/<case>/` holds `input.<from>`, `expected.<to>`, `losses.json` and
`case.json`, for the six pairs of spec 006. A case passes when `convert(input, from, to)` returns
`expected` byte for byte and `losses` equal to `losses.json` (criterion 1, 006 T2). Every
`expected.*` and `losses.json` was written by hand from rules C1–C7 of
`spec/006-convert-formats/spec.md` and changes only with a spec change (`AGENTS.md` rule 5).

- `losses.json`: `[{"kind": "comment" | "value", "offset", "length", "path"?}]` in input order;
  `path` (a JSON Pointer) on value losses only. A value loss is written as `null` (C4, UNK-034).
- `case.json`: `{"rules": [...], "location": ...}` (criterion 2). `rules` lists the C rules that
  rewrite bytes in the case; a superset pair's cases, which rewrite nothing, carry `["C7"]`.
  `location` is where those bytes are: `root` (in the root object, or outside any container),
  `nested-object` (in an object inside the root) or `array` (in an array, the root array
  included). Each case keeps the bytes it rewrites in one location. The values are `convert` in
  `tags.json`: criterion 2 names `array` as one location, so 002's `array-start/middle/end` are
  not reused.

Tests: `convert-apply.test.ts` runs criterion 1 on every case against core's `convert` (006 T2).
`convert.ts` loads the cases and lists the criterion 2 cells no case covers
(`convert-coverage.test.ts`); `convert-load.test.ts` tests the loader; `convert-corpus.test.ts`
checks the hand-written bytes against readings that do not use our format code
(`convert-reference.ts`, `JSON.parse`, the json5 package): input and expected are valid in their
formats (strict JSON for `json`; JSONC read as JSON once comments and trailing commas are gone);
expected has the input's data with `null` at each value loss, keys in the same order; to `json`
every comment is a comment loss, to `jsonc` and `json5` every comment is kept as written; to `json`
and `jsonc` every `NaN` and `Infinity` token is a value loss; every string, key and number token is
C1's, C2's or C3's rewrite of the input's (hexadecimal by `BigInt`) or kept byte for byte; `C1`–`C5`
are tagged exactly when the case uses them; each loss is in the case's `location`; superset pairs
return the input unchanged. C5's and C6's white space is checked by the Reviewer against the
readings below.

Readings the conversion corpus takes where C1–C7 leave a detail open:

1. **Offsets** count UTF-16 code units of the input, as JavaScript strings do. A `//` comment's
   length stops before its line ending.
2. **White space before a comment** (C5) is the run of white space right before it on its line,
   back to the previous token or the start of the line. A comment that starts a line after its
   indentation takes the indentation and leaves the space after it:
   `  /* old */ "a": 0,` becomes ` "a": 0,` (`json5-to-json/c5-root-block-comment-at-line-start`).
3. **A line left blank** (C5) is a line that held more than white space and holds only white space
   once its comments, and the white space before them, are gone. It is removed with its line
   ending; a multi-line block comment's line runs from the line it starts on to the line it ends
   on. A last line with no line ending loses its content only: the line break before it is a token
   C5 does not name, so it stays (criterion 5), and `{"a": 1}\n// end` becomes `{"a": 1}\n`. Lines
   that were already blank stay.
4. **JSON5-only white space** (C6) becomes one space per character, a byte order mark at the start
   of the text included. The cases with U+2028 or U+2029 outside a string use one line ending
   throughout, so "the document's line ending" has one reading.
5. **Strings** (C1): a string token that is valid JSON keeps its escapes and any literal U+2028
   (RFC 8259 allows it). One that is not is rewritten whole, so its valid escapes go too:
   `"\x41\u0042"` becomes `"AB"`.
6. **Hexadecimal zero with a sign** (C3) keeps the sign: `-0x0` becomes `-0`.

## CSV corpus (spec 009)

`csv/export/<case>/` holds `input.json`, `options.json`, `case.json` and either `expected.csv` or
`error.json`; `csv/import/<case>/` holds `input.csv`, `options.json`, `case.json` and either
`expected.json` with `warnings.json`, or `error.json`. A case passes when `jsonToCsv(input,
options)` gives `expected.csv` byte for byte, or `csvToJson(input, options)` gives `data`
deep-equal to `expected.json` (`isDeepStrictEqual`, key order checked) and `warnings` equal to
`warnings.json`; otherwise the error equals `error.json` (criterion 1, 009 T2). Every expected file
was written by hand from rules X1–X7 and I1–I7 of `spec/009-csv/spec.md` and changes only with a
spec change.

- `options.json`: the options of spec 009 §Options that differ from their defaults. Export:
  `delimiter` (`","`, `";"`, `"\t"`, `"|"`; default `","`), `header` (true), `flattenObjects`
  (true), `flattenArrays` (false), `bom` (false). Import: `delimiter` (left out for "Detect",
  I3), `header` (true), `nestedObjects` ("Nested objects from field names", true).
- `error.json` and each entry of `warnings.json`: `{"message"}` for export, `{"message", "line"}`
  for import, `line` 1-based.
- `case.json`: `{"rules": [...], "values"?: [...], "features"?: [...]}` (criterion 2). `rules`
  lists the X or I rules the case exercises; `values` the I7 value types it has (`number`, `true`,
  `false`, `null`, `empty`, `json`, `text`); `features` holds `one-column-null-row` for a
  one-column table with a `null` row. Delimiter and header coverage are read from `options.json`.
  The vocabulary is `csv` in `tags.json`.

Tests: `csv.ts` loads the cases and lists the criterion 2 cells no case covers
(`csv-coverage.test.ts`, run by `--coverage-only`); `csv-load.test.ts` tests the loader;
`csv-corpus.test.ts` checks facts that do not use core's CSV code: exported text is strict RFC 4180
with the case's delimiter, CR LF after every record, a BOM exactly when `bom` is on, one record per
row plus the header, every record the same width; export errors only for a row source that is not
an array or object; import data is an array of objects; message lines exist in the input; each
`values` and `features` tag matches the case's data.

Readings the CSV corpus takes where X1–X7 and I1–I7 leave a detail open:

1. **Messages.** The corpus fixes the texts. Export: `CSV export needs an array or an object`
   (X1). Import errors: `The CSV file is empty` (line 1) and `A quoted field is not closed` (the
   line of the opening quote). Import warnings: `Text after a closing quote is kept as part of the
   field` (I2, once per such field), `Field name "<name>" is repeated; this column is named
   "<new name>"` (I4), `Field name "<name>" conflicts with "<earlier name>"; it is kept as a flat
   key` (I5), `The record has more fields than there are field names; extra fields are kept as
   "Field 3", "Field 4"` (I6, once per record, naming each extra field).
2. **Lines** are physical lines of the input: CR LF, LF and CR each end one, inside quoted fields
   too. A record's line is the line it starts on. Field-name warnings (I4, I5) are on line 1.
   Warnings are listed by line, and within a line in column order, I4's before I5's.
3. **Text after a closing quote** keeps the field quoted, so it stays a string (I7): `"ab"cd` is
   `"abcd"` and `"p" q` is `"p q"`.
4. **Detection** (I3) counts the header among the first 10 records and finds records with the same
   quote rules for every candidate: `"a,b";c` splits on `;` only
   (`import/i3-detect-ignores-quoted-delimiters`). Only the first 10 records count: the 11th
   record of `i3-detect-reads-first-ten-records` would rule out `;`.
5. **Field-name notation** (I5) is read as written by §Terms: a first key (plain, or `["…"]` with a
   JSON string), then any of `.key`, `[n]` (decimal, no leading zero) and `["…"]`; a plain key is
   non-empty and has none of `.`, `[`, `]`, `"`. Anything else (`c.`, `d[x]`) is not notation and
   stays a flat key without a warning. A name conflicts when an earlier name's path is a prefix of
   its own or the other way round, or when it needs an object where an earlier name made an array
   (`t[0]` then `t.k`); the warning names that earlier field.
6. **Key order.** `input.json` and `expected.json` are read with `JSON.parse`, so integer-like keys
   (`"0"`, `"7"`) come first in their object, as in any JavaScript object; X2's columns follow that
   order (`export/x3-key-notation`).
7. **X6 white space** is what JavaScript's `\s` matches, a tab included (`"\tx"`). A string that
   I7 reads back as text (`007`, `1e3`, `-0`, `NaN`, `True`, `{}`) is not quoted.
8. **A non-object item** (X2) gets a column whose header is the empty string, written `""` by X6.

Not in the corpus because the spec leaves them open; 009 T2 raises an UNKNOWN if it must decide
them: an empty array or rows of `{}` only (no columns), non-object array items with "Flatten
nested arrays" on, ragged records with the header off, a rename that hits an existing name
(`a,a,a_1`), a plain field name holding `"`, and `NaN` or `Infinity` cells (X5), which
`input.json` cannot hold.
