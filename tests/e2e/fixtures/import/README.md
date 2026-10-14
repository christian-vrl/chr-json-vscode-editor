# YAML, TOML and XML command fixtures (spec 017, 017 T3)

Read by the desktop e2e suite (`packages/vscode-extension/test/e2e/import.cjs`) and the web e2e
suite (`packages/vscode-extension/test/web/suite/import.ts`). The golden corpus that pins the rules
themselves is `tests/golden/import/`; these files drive the commands. Each `expected.json` is written
by hand from the rules (output style of spec 017 §Terms).

- `yaml/config.yaml`: a Compose-like file with an anchor, a merge key (Y5; merged members take the
  place of `<<`, corpus README reading 7, and the member written in the mapping wins), an `on:` key
  that stays `"on"` (Y1) and a 20-digit id kept digit for digit (A2).
- `toml/Cargo.toml`: tables, an inline table and an array of tables (TM1).
- `xml/data.xml`: a declaration and a comment (not carried, XM1), a default namespace attribute
  (XM5), repeated elements (XM3), `1.50` kept as a string and `3` as a number (XM6), an empty element
  (XM2).
- `malformed/broken.<ext>`: one malformed file per kind for criterion 7 (an unclosed flow sequence, a
  repeated key, a mismatched close tag); the test holds each message with the library's place.
- `warnings/stack.yaml`: an unknown tag (Y7) and two documents (Y2), so the conversion has two
  warnings.
