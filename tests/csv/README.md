# CSV panel fixtures (spec 009, 009 T3)

Read by `pnpm test:web` (`tests/web/csv.spec.ts`), the dev host's unit test
(`packages/app-shell/test/dev-csv-host-adapter.test.ts`) and the VS Code e2e suite
(`packages/vscode-extension/test/e2e/csv.cjs`, 009 T4). The golden corpus that pins the rules
themselves is `tests/golden/csv/`; these files only drive the panel.

- `export/people.json`: three rows with a nested object, an array, an empty object and an empty
  array, and a name holding the delimiter.
- `export/many.json`: 250 rows, so the preview shows the first 100 only.
- `export/not-rows.json`: a string, which X1 refuses.
- `import/people.csv`: `;`-separated, with nested field names (I5) and an empty cell.
- `import/many.csv`: a header and 250 rows whose second field spans two lines, CR LF between records.
- `import/warnings.csv`: a repeated name (I4), text after a closing quote (I2) and an extra field (I6).
- `import/open-quote.csv`: a quote left open on line 3 (I2 error).
- `import/late-open-quote.csv`: 150 good rows, then a quote left open on line 152: past the preview,
  so only the full conversion finds it.
- `replace/<case>/`: spec 009 criterion 4. "Replace Document Data" with `data.csv` on `before.*`
  gives `expected-after.*` byte for byte: core's `diff` applied with the format's `applyPatch`, so
  members that survive keep their comments. `jsonc-comments` changes a value and removes a row,
  `json5-trailing` changes a value and adds a row (`;`-separated), `json-columns` adds a nested
  member from a dotted field name.
