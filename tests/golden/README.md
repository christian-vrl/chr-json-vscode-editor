# Golden corpus (spec 002)

One folder per case: `<format>/<case>/` with `input.<ext>`, `patch.json` (RFC 6902),
`expected.<ext>` and `case.json`. A case passes when `applyPatch(input, patch, format)` is byte-equal
to `expected` (criterion 1). Every `expected.*` was written by hand from rules R1–R10 of
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
- `coverage.test.ts` — criterion 4: every case carries all seven tags with known values, and every
  grid cell has a case per format.
- `corpus.test.ts` — checks the hand-written bytes against references independent of our format
  code: `JSON5.parse(expected)` deep-equals `immutable-json-patch` applied to `JSON5.parse(input)`
  (criterion 2); a `test-fail` patch throws there and `expected` equals `input` (R9); `expected` keeps
  the input's line endings and final newline (R10); `json` cases are strict JSON.

## Tags (`case.json`)

Values come from `tags.json`, the single vocabulary for these tests and `scripts/test-golden.mjs`.

| Tag | Meaning |
|---|---|
| `op` | the patch's operation; `test-fail` is a patch whose `test` fails, so the result is an error and unchanged text (R9). A `test` case may follow its `test` with another op, and a `test-fail` case may put an op before the failing `test` to show atomicity. |
| `location` | where the patch `path` points (for `move`/`copy`, the destination): `root` = a member of the root container; `nested-object` = a member of an object inside the root; `array-start` / `array-middle` / `array-end` = index 0 / an inner index / the last index (or `-` for `add`) of an array. |
| `comments` | comments on the member the op is about (UNK-008): `before` = comment line(s) above it (they travel with it on `remove`/`move` only when directly above, with no blank line between; `remove-root-comment-before-blank-line-stays` shows the other side); `after` = a comment at the end of its line; `inline` = a block comment inside its line, between its tokens; `none` = no comment next to it. For `add` that member is the neighbor: the previous last member when appending, the member now at that index when inserting. For `move`/`copy` it is the `from` member. |
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
2. **Inserting before a commented member.** A comment directly above a member belongs to it
   (UNK-008), so `add` at that member's index inserts above the comment.
3. **`move` moves text.** The moved member's value bytes are kept as written (R8: existing literals are
   never rewritten unless replaced), so `0x0A` stays `0x0A`. Carried comment lines take the new
   member's indentation (R1).
4. **`copy` does not copy comments.** Plan 002 defines `copy` as `add` of the value, and patch values
   are plain data.
5. **New containers.** A new object or array value in a multi-line container is written like
   `JSON.stringify(value, null, unit)`, indented from its member's line (R1).

The corpus avoids details R1–R10 do not fix: a new container value inside a single-line container,
removing the only member of a container, a new key that is not identifier-safe in JSON5, a string
containing the file's quote character, and a `test` on an object whose keys are in a different
order (the reference `immutable-json-patch` 6.0.3 compares key order; RFC 6902 §4.6 does not).
