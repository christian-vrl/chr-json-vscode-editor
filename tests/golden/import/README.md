# Import corpus (spec 017)

`<kind>/<case>/` holds `input.<kind>` (`input.yaml`, `input.toml` or `input.xml`), `case.json` and
either `expected.json` with `warnings.json`, or `error.json`. A case passes when the output text of
`importData(input, kind).data` (`stringify(data, 'json', OUTPUT_STYLE)`: 2-space indent, `\n`, a
final newline) is byte-equal to `expected.json` and `warnings` equals `warnings.json`, in order;
otherwise the error equals `error.json` (criterion 1, 017 T2). Every expected file was written by
hand from rules A1–A6, Y1–Y8, TM1–TM5 and XM1–XM8 of `spec/017-yaml-toml-xml-import/spec.md`
(as compact JSON, then laid out in the output style) and changes only with a spec change. Files
here are compared byte for byte, so Prettier skips this folder (`.prettierignore`).

- `warnings.json`: `[{"message", "line"}]`, `line` 1-based.
- `error.json`: `{"message"?, "line", "column"?}`, both 1-based (readings 3 and 4).
- `case.json`: `{"rules": [...], "tags": [...]}` (criterion 2). `rules` lists the rules the case
  exercises: A1–A6 for any kind, Y1–Y8 for `yaml`, TM1–TM5 for `toml`, XM1–XM8 for `xml`. `tags`
  lists criterion 2's tags the case covers, possibly none; `yaml-*`, `toml-*` and `xml-*` tags
  belong to their kind, and `malformed` marks a parser error (Y8, TM5, XM8). The vocabulary is
  `import` in `../tags.json`; `perKind` there names the tags criterion 2 asks for once per kind
  (`too-deep`, `malformed`) or for some kinds (`big-decimal`: YAML and XML).

Tests (in `tests/golden/`): `import.ts` loads the cases and lists the criterion 2 cells no case
covers (`import-coverage.test.ts`, run by `pnpm test:golden -- --coverage-only`);
`import-load.test.ts` tests the loader; `import-corpus.test.ts` checks facts that need no
importer: each `expected.json` is in the output style with every number written as `stringify`
writes it (002 R8, 015 B2: as `JSON.stringify`, `-0` as `-0`, a big number as its decimal text),
each tag holds for its case (a `bom` case starts with EF BB BF, a `toml-dates` case has all four
TM4 forms, and so on), messages name lines that exist and warnings come in line order, and the
messages the rules fix are used where they apply. The golden test itself is `import-apply.test.ts`
(017 T2).

## Readings the corpus takes where the rules leave a detail open

1. **Input text.** `importData` takes text, and A1 talks about bytes. The golden test gives it the
   file's bytes decoded as UTF-8 with the BOM kept and each invalid byte as U+FFFD
   (`new TextDecoder('utf-8', { ignoreBOM: true })`, `decodeInput` in `import.ts`), the text a
   command gets by decoding the bytes `workspace.fs` reads (T3). So a UTF-8 BOM arrives as U+FEFF, and
   a UTF-16 BOM (FF FE or FE FF; UTF-32 LE starts with FF FE too) as U+FFFD U+FFFD, which A1 reads
   as a UTF-16 or UTF-32 BOM (`yaml/utf16-bom` is UTF-16 LE, `xml/utf16-bom` UTF-16 BE). A Latin-1
   byte in `xml/encoding-latin1` arrives as U+FFFD; A1's error comes from its XML declaration.
2. **Messages.** The spec's templates mark placeholders with backticks, which are not part of the
   text. Where a rule gives no text, the corpus fixes one:
   - A1 `Only UTF-8 files can be converted`, A5 `The file is nested too deeply to convert (more
     than 1,000 levels)`, Y6 `The YAML file's aliases expand too far` (the spec's texts);
   - A3 `<path>: <value> has no JSON form; written as null`, `<path>` a JSON Pointer (RFC 6901, as
     spec 006's `losses.json` names paths) and `<value>` the value as written (`-.Inf`, `+inf`,
     `1e400`);
   - Y2 `The file holds <n> YAML documents; they became one array`;
   - Y4 `Key ["a","b"] is a sequence or mapping; it became its JSON text` and
     `Key "name" is repeated; its last value is kept` (the key as a JSON string);
   - Y7 `Tag !Ref was ignored (2 places)`, `(1 place)` for one;
   - XM3 `Child elements of <list> with different names are interleaved; their order is lost`;
   - XM4 `Text in <p> is mixed with elements; it became "#text" and its place is lost`;
   - XM7 `Entity &nbsp; was not expanded and is kept as written` (also for entities a DOCTYPE
     declares, which are never expanded);
   - TM2 `Integer 9223372036854775808 is outside the 64-bit range TOML allows` (the integer as
     written; reading 4).
3. **Errors that have no one place** (A1, A5, Y6) are on line 1 with no column: an encoding, a
   depth or an alias count belongs to the file, and A5 also comes from a library's `RangeError`,
   which has no position.
4. **Parser errors** (Y8, TM5, XM8) carry the line and column the parser reports and no
   `message`: the text is the library's, which no rule fixes, so criterion 1 compares line and
   column only (and T3's message shows the library's text). The places are, as the libraries
   report them: `yaml` 2.9.1 the first error's `pos[0]` offset as a 1-based line and column
   (`yaml/y8-malformed` 3:1, where the unclosed flow sequence is found); `smol-toml` 1.9.0
   `TomlError.line` and `.column` (`toml/tm5-duplicate-key` 3:1, `toml/tm5-table-defined-twice`
   4:2); `saxes` 6.0.0 the `line:column` of its error event (`xml/xm8-mismatched-tag` 1:10,
   `xml/xm8-two-roots` 2:3). TM2's 64-bit check is not the parser's: `smol-toml` 1.9.0 with
   `integersAsBigInt: 'asNeeded'` returns `9223372036854775808n` without an error, so the importer
   finds the integer itself and its error names the integer's first character
   (`toml/tm2-int64-overflow` 2:11), with the text of reading 2.
5. **Warning lines.** A3: the value's line. Y2: the line of the second document's `---`. Y4: the
   repeated key's line, or the `?` of a complex key. Y7: the tag's first use. XM3 and XM4: the
   line of the element's start tag. XM7: the reference's line, one warning per distinct name in
   order of first use. Warnings are listed by line, in document order within a line. `smol-toml`
   gives no position for values, so the importer finds A3's TOML lines itself (as for TM2).
6. **Depth** (A5) counts containers, the root one as level 1, and the cases are one level past
   the limit: `yaml/too-deep` is 1,001 nested flow sequences; `toml/too-deep` is the root table
   and 1,000 nested arrays (which `smol-toml`'s own default `maxDepth` of 1,000 lets through); in
   `xml/too-deep` the XM1 object is level 1 and each of the 1,000 outer elements, having a child
   element, is an object one level deeper, so 1,001 nested elements make 1,001 levels. The limit
   from below (1,000 levels convert) is left to T2's unit tests: its `expected.json` would be
   about 1 MB of indentation. `yaml` 2.9.1 overflows the stack well before 1,001 levels, so YAML
   stops at 500 levels with its own message and `yaml/too-deep`, deeper than 1,000, still gives
   A5's (A5, 017 T2; `packages/core/test/import.test.ts` covers both limits).
7. **Merge order** (Y5): merged members take the place of the `<<` key, the first merged mapping's
   members first, then the later ones' members not already there; a member written in the
   mapping keeps its value, and its place when written before `<<`, while one written after it
   keeps the place the merge gave it (A4: first occurrence). This is what `yaml` 2.9.1's `toJS`
   gives (plan risk R2).
8. **Keys** (Y4). A non-string scalar key is its source text (`0x10` stays `"0x10"`), also under
   `%YAML 1.1`, where `on`, `off` and `y` would be booleans: they stay three keys
   (`yaml/y1-yaml-1-1`). A collection key is `JSON.stringify` of its value, numbers per A2.
9. **Tags** (Y7) are named as written (`!Ref`, `!!binary`). `!!binary`, which `yaml` resolves to
   bytes, is ignored like any other non-core tag: its value is the plain text. Core tags (`!!str`,
   `!!int`) apply with no warning.
10. **XML text** (XM4): each run of character data and CDATA between child elements is trimmed,
    runs left empty are dropped, and the rest are joined with one space; CDATA and the text next
    to it form one run (`pre <![CDATA[<mid>]]> post` is `"pre <mid> post"`). XM6 then reads the
    result, `#text` included. `<c>   </c>` is `""`.
11. **XM6 edge values** follow its two tests literally: `-0` stays a string
    (`JSON.stringify(-0)` is `"0"`, and `-0` is not a big number), `1e400` becomes a number (a big
    number, kept as its decimal text).
12. **Negative zero.** YAML `-0` is an integer whose decimal digits give `-0` (A2); TOML's `-0.0`
    is binary64 negative zero (TM3); both are written `-0`. TOML's integer `-0`, which TOML 1.0.0
    makes equal to `0`, has no case.

Not in the corpus, left to T2: an integer-like key (`"1"`) after another key, which a JavaScript
object lists first whatever A4 says; a non-finite value at the root, whose JSON Pointer is the
empty string; the YAML 1.1 `_` in a float (`1_000.5`), which A2 does not name.
