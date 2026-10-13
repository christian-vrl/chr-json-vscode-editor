# JSON Schema generation corpus (spec 016 criteria 1 and 2)

One folder per case, `tests/schema-gen/<case>/`:

- `case.json`: `format` (`json`, `jsonc`, `json5` or `jsonl`; a list of formats for `same-data`),
  `dialect` (`draft-07` or `2020-12`, the generator's dialect names), and `tags` from `tags.json`.
- `input.<ext>`: the document, one per format `case.json` names, `ext` being the format.
- `expected.schema.json`: the schema file, `JSON.stringify(schema, null, 2)` plus `\n`, written by
  hand from G1–G9 below. A `too-deep` case has none: it expects G9's error.

`corpus.test.ts` (criterion 1) checks that the schema file of
`generateSchema(parseData(format, input), dialect)` is byte-equal to `expected.schema.json` for
every input, passing `{ lines: true }` for `jsonl` inputs (G8: the items alone cannot tell a JSON
Lines document from a JSON array). `coverage.test.ts` (criterion 2) checks there is a case per tag in
`tags.json`, and that the `scalar-root` cases cover the null, boolean, string, integer and number
roots. The folders are in `.prettierignore`: inputs keep each format's syntax and the expected
files are compared byte for byte. G9's boundary (1,000 levels generate, 1,001 do not) is in
`packages/core/test/schema-generate.test.ts`, since a 1,000-level schema is megabytes.

## Rules (spec/016-generate-schema/spec.md §Generation rules)

- **G1** `null` → `"null"`, booleans → `"boolean"`, strings → `"string"`, a number →
  `"integer"` when `Number.isInteger(n)` (`-0`, `2.0`, `1e300`), else `"number"` (`NaN`,
  `±Infinity`); arrays → `"array"`, other objects → `"object"`.
- **G2** A schema describes a set of values: `type` is one string, or an array in the order
  `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`; `number` absorbs `integer`.
- **G3** `properties`: every key of the set's objects, in the order first met, each with the schema
  of that key's values; `required`: the keys every one of those objects has, in `properties` order.
  Neither is written empty; no `additionalProperties`. `__proto__`, `constructor`, `$ref` are
  ordinary own keys. The order is the data's key order, which is document order except that
  JavaScript puts array-index keys (`"1"`, `"2"`) first, ascending, in every parsed object.
- **G4** `items`: one schema for all elements of the set's arrays; not written when all are empty.
- **G5** No `format`, `enum`, `const`, `pattern`, length, range, `title`, `description`, `examples`
  or `$id`.
- **G6** Key order: `$schema` (root only), `type`, `properties`, `required`, `items`.
- **G7** Comments, trailing commas, quoting and other JSONC/JSON5 syntax play no part (`same-data`).
- **G8** `jsonl`: the schema of the set of all items, one line; empty → `$schema` alone.
- **G9** More than 1,000 levels (an array or object is one level; `[[1]]` is two): "The document is
  nested too deeply to generate a schema (more than 1,000 levels)."
