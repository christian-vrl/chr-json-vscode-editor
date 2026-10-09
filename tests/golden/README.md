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
| `pnpm test:golden -- --coverage-only` | only `coverage.test.ts` (criterion 4) |
| `pnpm test:golden -- --format json,jsonc --op add,remove` | per-case tests for those cases only; fails if a named format, op, or (format, op) pair has no case |

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
2. **Inserting before a commented member** (UNK-022, open; the corpus follows its ★ option). A comment directly above a member belongs to it
   (UNK-008), so `add` at that member's index inserts above the comment.
3. **`move` moves text.** The moved member's value bytes are kept as written (R8: existing literals are
   never rewritten unless replaced), so `0x0A` stays `0x0A`. Carried comment lines take the new
   member's indentation (R1).
4. **`copy` does not copy comments** (UNK-023, open; the corpus follows its ★ option). Plan 002 defines `copy` as `add` of the value, and patch values
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
