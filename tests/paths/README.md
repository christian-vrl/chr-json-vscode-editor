# Copy path corpus (spec 018 criteria 1 and 2)

One folder per case, `tests/paths/<case>/`:

- `case.json`: `format` (`json`, `jsonc`, `json5` or `jsonl`) and `tags` from `tags.json`.
- `input.<ext>`: the document, `ext` being the format. Offsets refer to the file as written, so the
  folders are in `.prettierignore`.
- `expected.json`, written by hand from the rules below:
  - `nodes`: `{offset, jsonpath, pointer}`, the P1 and P2 text of `nodeAt(format, input, offset)`,
    or `{offset, error: {line, column}}` where the text up to the offset does not read (A6).
  - `places`: `{pointer, offset}`, the result of `placeOf(format, input, path)`, or
    `{pointer, none: true}` when it gives none. `pointer` is read as P3 reads it against the
    input's data (a step into an array is an index); when the input has no data (a broken text),
    a step that is an array index token is read as an index.

`corpus.test.ts` (criterion 1) checks every listed node and place. `coverage.test.ts` (criterion 2)
checks there is a case per tag in `tags.json`, that the name tags hold the names the criterion
lists, and that the locating tags hold the offsets it lists. Criteria 3 and 4 (fast-check) are in
`packages/core/test/paths.property.test.ts`.

Offsets count UTF-16 code units, from 0 to the text's length; an offset sits between two
characters. Lines and columns count from 1, as VS Code shows them: a line ends at `\n`, `\r\n` or
`\r`, and a column counts UTF-16 code units.

## Rules (spec/018-copy-path-reveal-node/spec.md §Path text, §Locating)

- **P1 JSONPath:** `$`, then `[i]` per index, `.name` per name matching RFC 9535's
  member-name-shorthand (an ASCII letter, `_` or a character from U+0080 up that is not a lone
  surrogate, then those or ASCII digits), and `['…']` per other name, escaped as RFC 9535 §2.7:
  `\\`, `\'`, `\b` `\f` `\n` `\r` `\t`, other U+0000–U+001F as `\u00xx`, a lone surrogate as
  `\uxxxx` (lowercase hex), every other character as itself.
- **P2 JSON Pointer:** `''` for the root, else `/` before each step, `~` as `~0` and `/` as `~1`.
- **P3 Reading:** spaces, tabs and line breaks before the text are ignored, and after it too except
  after a JSON Pointer, where they belong to its last name (so P4 holds for a name ending in a
  space). Empty or `$` is the root; a JSONPath is `$` with `.name`, `['…']`, `["…"]` (RFC 9535
  string escapes, plus `\uxxxx` for a lone surrogate as P1 writes it) and `[i]` parts; a JSON
  Pointer starts with `/`, and a step is an index when the value it steps into is an array and the
  step is `0` or digits without a leading zero. Anything else is refused with "Not a path to one
  node: `<reason>`."
- **P4:** reading a path's P1 text, or its P2 text against its data, gives the path back.
- **Touching:** an offset touches a token from just before its first character to just after its
  last. Every character belongs to one token: white space runs, line breaks, comments, punctuation,
  strings, numbers and literals. Of the tokens an offset touches, the one whose node is innermost
  decides (A4's tie: in `[1,`, the offset after `1` gives `$[0]`).
- **A1 Key:** a member name or the `:` after it gives the member's value's path.
- **A2 Scalar:** a string, number, `true`, `false` or `null` value gives its own path.
- **A3 Bracket:** an object's or array's `{` `}` `[` `]` gives that object's or array's path.
- **A4 Between:** white space, line breaks, commas and comments inside an object or array give the
  innermost object or array around them (so do those between a key and its `:` and between the
  `:` and the value, which are no part of the key).
- **A5 Outside:** white space, comments and a leading BOM before or after the root give the root
  (`$`). In `jsonl` an offset on a blank line (only spaces and tabs) gives the root; on any other
  line it is read in that line alone, its item's index (the number of non-blank lines before it,
  bad lines included) first. An offset in the line ending counts as the end of the line.
- **A6 Broken text:** only the text up to the end of the last token starting at or before the offset
  is read (in `jsonl`, from the start of the line). If it does not read as the format, the result
  is the first error in it. `json` reads as `jsonc` (comments and trailing commas are warnings, not
  errors, in core's `parse`); a `jsonl` line reads as strict JSON (RFC 8259: no comments, no
  trailing commas, white space only spaces and tabs).
- **R1 Place:** a member's place is the first character of its key, quote included; an array
  element's or the root's is the first character of its value. `jsonl`: an item's place is its
  value's first character; the root's is the start of the first blank line, or 0 when there is
  none (then no offset gives the root, so R3 has no offset to hold at).
- **R2 Duplicate names:** the last member with that name, whose value the data holds; a path
  through an earlier duplicate has no place. So `placeOf` reads on to the end of every object on
  the way to the node, and gives no place when the text stops reading as its format before then.
- **R3 Round trip:** the node at the place of a path has that path.
