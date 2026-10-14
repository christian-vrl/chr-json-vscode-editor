# Import into a document (spec 017 criterion 6, 017 T3)

`replace/<case>/`: "Import YAML, TOML or XML…" with `data.<ext>` on `before.*` gives
`expected-after.*` byte for byte: core's `diff` applied with the format's `applyPatch` (002 R14), so
members that survive keep their comments. Read by `packages/vscode-extension/test/e2e/import.cjs`
(every case) and the web e2e suite (`jsonc-yaml`).

- `jsonc-yaml`: changes a value (its line comment stays) and removes a member with its block comment.
- `json-toml`: changes a nested value and adds a table.
- `json5-xml`: adds an item to an array; the repeated `<tags>` become an array (XM3), and the comment
  on the member that stays is kept.
