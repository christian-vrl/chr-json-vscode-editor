# SPEC 010 — Smart format

> **Status:** `draft`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
v1's Format (003 T8, core `prettyPrint`) puts every member of every container on its own line. Data
with many short arrays and small objects (coordinates, records, matrices) becomes long and hard to
scan. jsoneditoronline.org offers "Smart Format" beside "Format" and "Compact" in its text mode:
small arrays and objects stay on one line, similar objects line up as a table, and long arrays of
short values wrap several items per line. The site uses the FracturedJson library (MIT) for this and
warns it "can be much slower for large documents" (UNK-013 evidence). The feature map lists it as
site-only and P1 ("Smart format (short arrays and objects on one line)"); the editor library does not
have it.

## Goal
"Smart Format" rewrites the layout of a JSON, JSONC or JSON5 document the way the site does, changing
only white space (and trailing commas per UNK-046), keeping every key, value and comment as written,
in the same order, as one undoable edit.

## Terms
- **Layout token:** white space, a line break, or a comma.
- **Kept token:** every other token of the input: brackets, colons, keys, values and comments.
- **Threshold:** spec 008's 5 MiB (5,242,880 bytes of UTF-8 text, UNK-014).

## Acceptance criterion (falsifiable)
`smartFormat(text, format)` in `packages/core` returns the new text, or throws `PatchError` when the
text has a parse `error` diagnostic. Its layout is FracturedJson 5.1.0's with the options in §Layout.

1. **Golden:** for every case in `tests/golden/smart-format/<format>/<case>/` (`input.<ext>`,
   `expected.<ext>`, `case.json`), `smartFormat(input, format)` is byte-equal to `expected.<ext>`.
2. **Coverage:** each case's `case.json` holds tags `{layout, comments, trailingComma, special, style}`;
   a coverage test asserts, per format, at least one case for each `layout` ∈ {inline, compact-array,
   table, expanded}, each `style` ∈ {indent-tab, indent-2, indent-4, crlf, no-final-newline,
   bom, one-line-input}, and `special` = key-order (rows of one array whose keys come in different
   orders, UNK-045); for jsonc and json5, each `comments` ∈ {before, after, inline, standalone,
   multi-line-block, between-key-and-value, header, footer} and `trailingComma` ∈ {yes, no}; for json5,
   each `special` ∈ {unquoted-key, single-quote, hex, infinity-nan, plus-sign, leading-dot,
   line-continuation}.
3. **Nothing but layout changes (fast-check, seed committed, 10 000 runs per format, plus every golden
   input of 002 and 006):** for every input with no parse `error`, the output parses with no `error`
   in the same format; its data equals the input's under `isDeepStrictEqual` (`__proto__` keys,
   duplicate keys and `-0` included); the keys of every object come in the same order; and the
   sequence of kept tokens is the input's, each byte-identical, except that a multi-line block
   comment's lines after the first may change their leading white space. Comma changes are only those
   UNK-046 allows; for `json` the output has no comment and no trailing comma it did not have.
4. **Stable:** `smartFormat(smartFormat(x, f), f) === smartFormat(x, f)` over the same generator.
5. **Style kept:** the output's indent unit is the input's detected one (`Style.indent`; a document
   with no line breaks gets 2 spaces, 002 R1); line endings are the input's (002 R10); it ends with a
   line ending exactly when the input did; a leading BOM stays. A text with no value (empty, white
   space or comments only) is returned unchanged.
6. **Line length:** every output line longer than 120 characters (indentation included, a tab counted
   as the indent width) holds at most one key and one scalar value, plus comments.
7. **Text mode (web):** in the CHR JSON editor's text mode the menu shows "Smart format" between
   "Format" and "Compact", as on the site; clicking it sends a `smartFormat` action to the host (a
   protocol bump) and the text shown becomes the golden output for `tests/e2e/fixtures/smart-format/*`
   in the dev host. The tree and table menus are unchanged.
8. **Command (e2e):** "Smart Format" (`chrJsonEditor.smartFormat`, command palette) runs on the active
   CHR JSON editor in any mode and on the active text editor for `json`, `jsonc` and `json5`
   documents. On `tests/e2e/fixtures/smart-format/*` the document text becomes `expected.*` byte for
   byte through one `WorkspaceEdit`, the document is dirty and not saved, and one undo restores the
   previous text exactly. When the text is already smart-formatted, no edit is made.
9. **Broken source (e2e):** on a document whose parse has an `error` diagnostic, nothing changes and
   a message says "Smart Format needs valid `<format>`. Fix the errors or run Repair JSON first."
10. **Large files (e2e):** for a document above the threshold the command, from either editor,
    changes nothing and says "Smart Format is off for documents above 5 MiB because it can take a
    long time. Use Format instead." (A large-file tab has no text mode, spec 008 criteria 2 and 4, so
    the menu item never shows there.)
11. **Speed (bench):** `bench/RESULTS.md`, regenerated in one run, gives `smartFormat`'s median time
    for json, jsonc and json5 at 1 and 5 MiB beside `prettyPrint`'s. HYPOTHESIS: the 5 MiB median is
    under 5 s on the CI runner (FracturedJson alone took 2.3 s on a 4.8 MiB array of records in this
    spec's sandbox check). If it is not, an UNKNOWN goes to the owner (lower the limit for smart format
    or accept the time) before T3 merges.
12. **License, offline, credit:** `fracturedjsonjs` is pinned to exactly 5.1.0 (MIT) and passes
    `pnpm check:licenses`; `pnpm check:offline` stays green; the README's credits name FracturedJson
    and its MIT license next to jsoneditoronline.org.

## Layout (FracturedJson 5.1.0 options; golden cases encode these)
`FracturedJsonOptions.Recommended()` (line length 120, inline complexity 2, compact-array complexity 2,
table-row complexity 2, table segments on, property-name padding up to 16, numbers aligned by decimal
point without rewriting them), except:
- **L1 Indent** from the document's style: a tab indent uses tabs; N spaces use N spaces (criterion 5).
- **L2 Line endings and final newline** from the document's style; a BOM is kept (criterion 5).
- **L3 Comments** are kept (`CommentPolicy.Preserve`) in all three formats; a `.json` file read with
  comment warnings keeps them too.
- **L4 Blank lines** between members are kept (`PreserveBlankLines`), as in JSONC config files where
  they group settings.
- **L5 Key order** is never changed (UNK-045 ★): an array whose object rows list their keys in
  different orders is not laid out as one table where that would reorder them.
- **L6 Trailing commas** in JSONC and JSON5 per UNK-046 ★: a container written on several lines keeps
  a trailing comma after its last member when it had one; a container written on one line (inline, a
  table row, a compact-array row) has none. JSON never has one.
- **L7 JSON5 tokens** that JSON lacks (unquoted keys, single quotes, hex, `Infinity`, `NaN`, a `+` or a
  leading or trailing `.`, line continuations) are kept byte for byte; they count with their written
  width when FracturedJson measures line length and columns.
- **L8 Options** are fixed (UNK-047 ★): no setting changes them in this spec; spec 019 (Settings) may
  add line length and the others later.

## Where we differ from jsoneditoronline.org
- The site's Smart Format re-serializes data: with FracturedJson it can reorder keys inside table
  rows (seen with 5.1.0's `Reformat` in this spec's sandbox check: `{"b":20,"a":10}` became
  `{"a": 10, "b": 20}` as a table row). We keep key order (L5, UNK-045).
- The site's text mode is strict JSON. We keep JSONC and JSON5 comments, JSON5 syntax and, per
  UNK-046, trailing commas (L3, L6, L7), like spec 006 keeps them on conversion.
- The site's indent is its own setting; ours follows the document (L1), like Format (002 R1).
- We also offer a command for VS Code's text editor (criterion 8), and smart format is off above 5 MiB
  (criterion 10), where the site only warns that large documents are slow.
- No options panel (L8, UNK-047); the site shows none either for Smart Format.

## Scope
- **In:** `smartFormat` in `core` on FracturedJson 5.1.0, the JSON5 and key-order handling, golden
  corpus and property suite, the text-mode menu item and the `smartFormat` action, the command, the
  broken-source and large-file messages, the bench column, the README credit.
- **Out:** options and settings (019); smart format of a selection or a node only; making it the
  default of Format or of Ctrl+I; a VS Code `DocumentFormattingEditProvider` (it would compete with the
  user's default formatter for `.json`); formatting after conversion (006's off-the-path note); NDJSON
  (012); the Chrome app (020), which gets the menu item with app-shell.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md:24` (site-only "Smart format (keeps short arrays and
  objects on one line)") and `:109` (P1, ours, S); `spec/INDEX.md` P1 row 010 ("FracturedJson library
  (MIT), as the site uses"); UNK-013 resolution (site features page and
  https://jsoneditoronline.org/indepth/beautify/smart-json-formatting/: text mode has "Format",
  "Smart Format" and "Compact" side by side; slower for large documents; FracturedJson; re-fetched
  2026-10-09).
- Library: npm `fracturedjsonjs@5.1.0`, `"license": "MIT"`, no dependencies, no URL in `dist/`, no
  Node API; `Formatter.Reformat(text)` with `FracturedJsonOptions` (`dist/FracturedJsonOptions.d.ts`:
  `CommentPolicy`, `AllowTrailingCommas`, `PreserveBlankLines`, `IndentSpaces`, `UseTabToIndent`,
  `JsonEolStyle`, `NumberListAlignment`), `Formatter.StringLengthFunc` for widths.
- Sandbox check of 5.1.0 (2026-10-09, `Recommended()` + `Preserve`): rejects JSON5 syntax (`{a:1}`,
  `'a'`, `0x10`, `Infinity`: "Unexpected character"); keeps number tokens (`1.50`, `1e400`,
  `12345678901234567890123`) and duplicate keys; drops trailing commas; keeps comments, re-indenting
  multi-line block comments; reorders keys in table rows (3 of 3,000 random documents; L5); stable on
  all 3,000; 2.3 s for a 4.8 MiB array of records.
- Format today: `packages/core/src/formats/actions.ts:38` (`prettyPrint`, keeps every token and
  comment, uses the document's indent unit); host action switch
  `packages/vscode-extension/src/documentSync.ts:131-149` (`runAction`); webview menu routing
  `packages/app-shell/src/App.svelte:173-205` (`jse-format`, `jse-compact`); action names
  `packages/app-shell/src/protocol.ts:52-59` (`ACTION_NAMES`), `PROTOCOL_VERSION` 9 at `:18`.
- Same bar as earlier owner decisions: comments kept through whole-document actions (UNK-015, 002
  R12–R14); conversion keeps layout and comments (UNK-033); JSONC keeps the file's trailing-comma
  style on write (ADR-005).
- Large files: spec 008 criteria 1–4 (threshold, whole-document actions not offered when locked).
- Broken source message: spec 006 criterion 7.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-045 | May smart format reorder keys to line up a table | L5, criterion 3; T1, T2 | see ledger (owner) |
| UNK-046 | Trailing commas in JSONC and JSON5 after smart format | L6, criterion 3; T1, T2 | see ledger (owner) |
| UNK-047 | Fixed options or user settings now | L8; T2, T3 | see ledger (owner) |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [ ] Human approval recorded
