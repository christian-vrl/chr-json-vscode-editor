# JSON Schema dialect fixtures (spec 004 criteria 2 and 3)

`schema.test.ts` runs every `<dialect>/<case>/` here through the extension host's validator
(`packages/vscode-extension/src/validation.ts`, 004 T4):

- `schema.json`: the schema. The dialect comes from its own `$schema` (UNK-017); the folder name is
  the dialect the test expects. A schema with no `$schema`, or one naming no known dialect
  (UNK-031), runs as draft-07 and is reported as `assumed`; those cases are named `assumed-*`.
- `doc.json`, `doc.jsonc` or `doc.json5`: the document, parsed with the format its extension names.
- `expected-errors.json`: every error Ajv reports (`strict: false`, `allErrors: true`,
  `ajv-formats`), as `[{instancePath, keyword}]` sorted by `instancePath`, then `keyword`.

Each dialect has a case whose schema `$ref`s the dialect's own meta-schema, which only resolves
because Ajv's meta-schemas are bundled, and a case whose result depends on the dialect (the same
`prefixItems` + `items: false` schema fails under 2019-09 and passes under 2020-12; draft-07
ignores `dependentRequired` and `unevaluatedProperties`; draft-04's boolean `exclusiveMaximum` and
draft-06's numeric `exclusiveMinimum` are each invalid in the other draft). draft-04 runs on
`ajv-draft-04` (UNK-031), draft-06 on `Ajv` with the draft-06 meta-schema `ajv` ships.

With `allErrors`, Ajv also reports the item errors behind a failed `contains` (`/tags/1 const` in
`2020-12/prefix-items-formats`), and `propertyNames` reports the inner keyword at the object's own
path (`"" maxLength` in `2019-09/dependent-unevaluated`).

Criterion 3 (remote `$ref` reported as not loaded, zero network requests) is in the same test file.
