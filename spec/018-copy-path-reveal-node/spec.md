# SPEC 018 — Copy path and reveal node

> **Status:** `draft`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
A user who finds a value in a big document often needs to say where it is: in a JSON Schema
`$ref`, a JSON Patch, a Transform query (specs 011, 014), a bug report or a code review. Today
the only way to get that path is the library's navigation bar in tree mode, which writes it in the
library's own notation (`people[1]["a.b"]`, neither JSONPath nor JSON Pointer), and nothing at all
in text or table mode or in VS Code's text editor. The opposite move is missing too: with the
cursor on a key in the text, there is no way to see that node in the tree, and switching the
editor from text mode to tree mode loses the place (§Current evidence). The feature map lists "Copy
path as JSONPath or JSON Pointer, reveal node from text cursor" as P2, library plus our work
(`docs/research/feature-map.md:116`).

## Goal
From any view of a document (tree, table or text mode in the CHR JSON editor, or VS Code's text
editor), one command copies the path of the node at the selection or cursor as JSONPath or JSON
Pointer (UNK-080), and one command shows that same node in the other editor, so the user never has
to look for it by hand.

## Terms
- **Source data**, **threshold**, **ceiling**, **locked:** as spec 016 and spec 008: core's
  `parseData(format, text)` of the document's text in the format its badge shows; 5 MiB
  (5,242,880 bytes of UTF-8 text when the command runs); VS Code's 50 MB sync limit; a large-file
  tab not unlocked with "Edit anyway".
- **Path:** the list of steps from the root of the source data to one node; a step is a member name
  (a string, any string) or an array index (an integer ≥ 0). The root's path is empty. In a `jsonl`
  document the data is the array of items (spec 012), so the first step is the item's index.
- **Node at an offset**, **place of a path:** core functions on the text, defined in §Locating
  (A1–A6, R1–R3). Offsets count UTF-16 code units, as VS Code's `offsetAt` and the library do.
- **Current node:** the node a command acts on. In VS Code's text editor and in the CHR editor's
  text mode, the node at the offset of the main cursor (the selection's active end). In tree and
  table mode, the node of the library's selection (S1).
- **Other editor:** for a document shown in the CHR JSON editor, VS Code's text editor on it, and the
  other way round.

## Path text (the corpus encodes these)
- **P1 JSONPath:** `$`, then one part per step: an index `i` as `[i]`; a name that matches RFC
  9535's member-name-shorthand (`name-first *name-char`: first an ASCII letter, `_` or a character
  from U+0080 up other than a lone surrogate, then those or ASCII digits) as `.name`; any other name as `['…']`, escaped as RFC
  9535 §2.7 normalized paths escape it: `\\` and `\'`, `\b` `\f` `\n` `\r` `\t`, any other
  U+0000–U+001F as `\u00xx` with lowercase hex, a lone surrogate as `\uxxxx` (lowercase), every
  other character as itself (UNK-081, delegated: shorthand where the name allows it). Examples:
  `$`, `$.people[1].name`, `$.people[1]['a.b']`, `$['0']`, `$['it\'s']`, `$['']`, `$.é`.
- **P2 JSON Pointer:** RFC 6901's string form: `''` for the root, else `/` before each step, with
  `~` written `~0` and `/` written `~1` in names, and indices in decimal. Examples: `''`,
  `/people/1/name`, `/people/1/a.b`, `/a~1b`, `/m~0n`.
- **P3 Reading a path text** (the navigation bar's edit box, S3): text that is, spaces around it
  aside, empty or `$` (the root); a JSONPath of `$` followed by `.name` (shorthand as P1), `['…']`
  or `["…"]` (RFC 9535 string escapes) and `[i]` (an integer ≥ 0 without leading zeros) parts; or a
  JSON Pointer starting with `/` (RFC 6901, `~` only before `0` or `1`). Anything else, including
  wildcards, filters, slices, `..` and negative indices, is refused with "Not a path to one node:
  `<reason>`." A JSON Pointer step names an array index when the value it steps into is an array
  and the step is `0` or digits without a leading zero, else a member name (RFC 6901 §4).
- **P4 One text per path:** reading the P1 text of any path (P3) gives that path back, and so does
  reading its P2 text against the data it was taken from.

## Locating (the corpus encodes these)
- **A1 Key:** an offset on a member's key (from its first character, quote included, to just after
  its last) or on the `:` after it gives that member's value's path.
- **A2 Scalar:** an offset from the first character of a string, number, `true`, `false` or `null`
  value to just after its last gives that value's path.
- **A3 Bracket:** an offset on an object's or array's opening or closing bracket (just before or just
  after it) gives that object's or array's path.
- **A4 Between:** any other offset inside an object or array (spaces, line breaks, commas,
  comments) gives the path of the innermost object or array around it. Where two of A1–A4 meet at
  one offset (`[1,` with the offset just after `1`), the innermost node wins.
- **A5 Outside:** an offset before or after the root value (spaces, comments, a BOM) gives the root.
  In `jsonl`, an offset on a non-blank line is read in that line alone, the line's item index first
  (`$[i]…`); an offset on a blank line gives the root.
- **A6 Broken text:** the text from the start of the document (in `jsonl`, of the line) to the end of
  the token at the offset must read as the format; text after it is not read. Otherwise there is no
  node, and the error's line and column are reported.
- **R1 Place of a path:** the offset where a node starts in the text: for a member's value, the
  first character of its key (quote included); for an array element or the root, the first
  character of the value. A path whose node is not in the source data has no place.
- **R2 Duplicate names:** when an object has a name twice (JSONC and JSON5 allow it), the place is
  the last of them, whose value the source data holds (002's adapters keep the last).
- **R3 Round trip:** the node at the place of a path (A1–A5) has that path.

## Showing and copying (the CHR JSON editor and VS Code)
- **S1 Selection in tree and table mode:** a key, value or edit selection, and an "inside" or
  "after" caret, give the library's selection path (an "inside" caret its container, an "after"
  caret the node before it); a multi-selection of one node gives that node; a multi-selection of
  several gives none, with "Select one node to copy its path."; no selection gives the root.
- **S2 Context menu:** the library's tree-mode and table-mode context menus get, in one group after
  "Copy compacted": "Copy JSONPath", "Copy JSON Pointer" (per UNK-080 ★) and "Reveal in Text
  Editor". They are offered in locked large-file tabs too (008 criterion 2: select and copy work).
- **S3 Navigation bar:** the library's navigation bar (tree mode) keeps its look, but its edit box
  shows the current node's P1 JSONPath, reads text per P3 (so a copied JSONPath or JSON Pointer
  pasted there selects that node), and its copy button copies that JSONPath. Every copy goes
  through the host (`vscode.env.clipboard`), not the page's clipboard.
- **S4 Mode switch keeps the place:** switching the CHR editor from tree or table mode to text mode
  puts the text cursor at the current node's place (R1) and scrolls it into view; switching from
  text mode to tree mode selects the node at the cursor (A1–A5), expanding its parents and
  scrolling to it; switching to table mode selects that node's cell when the table shows it, and
  otherwise leaves the selection empty. A broken text (A6) switches mode as today, selecting
  nothing.
- **S5 Commands** (command palette, category "CHR JSON Editor"; no default keybinding):
  - "Copy JSONPath" (`chrJsonEditor.copyJsonPath`) and "Copy JSON Pointer"
    (`chrJsonEditor.copyJsonPointer`): in the CHR editor (any mode) and in VS Code's text editor on
    a `json`, `jsonc`, `json5` or `jsonl` document, also in the text editor's context menu. They put
    the current node's P1 or P2 text on the clipboard and show "Copied `<text>`" in the status bar
    for 3 seconds (the root's pointer as "Copied the empty JSON Pointer (the whole document)").
  - "Reveal in CHR JSON Editor" (`chrJsonEditor.revealInEditor`), from VS Code's text editor
    (palette and context menu), and "Reveal in Text Editor" (`chrJsonEditor.revealInText`), from the
    CHR editor (palette and S2's menu). They show the current node in the other editor: when a tab
    of the other editor on the same document is open in any group, that tab is made active;
    otherwise the current tab is replaced, as "Open in CHR JSON Editor" and "Reopen as Text" do
    (UNK-082 ★). In the CHR editor the node is selected and scrolled to (S4's way, in the tab's
    mode); in the text editor the cursor goes to its place (R1), and that line is revealed in the
    center when it is outside the viewport.
- **S6 No node:** when the current node has no path (A6) or no place (R1, a text edited since), the
  commands do nothing but show "CHR JSON Editor: can't find the node: the document is not valid
  `<format>` (error at line `l`, column `c`). Fix it or run "Repair JSON" first." (spec 016
  criterion 6's wording) or "CHR JSON Editor: can't find the node: `<JSONPath>` is not in the
  document."; nothing is copied and no tab changes.

## Acceptance criterion (falsifiable)
1. **Corpus (core unit):** for every case in `tests/paths/<case>/` (`input.<ext>` with ext in
   `json`, `jsonc`, `json5`, `jsonl`; `case.json` with `format` and `tags`; `expected.json` with
   `nodes`, a list of `{offset, jsonpath, pointer}` or `{offset, error: {line, column}}`, and
   `places`, a list of `{pointer, offset}` or `{pointer, none: true}`), core's `nodeAt(format, text,
   offset)` gives each listed node (as P1 and P2 text) or error, and `placeOf(format, text, path)`
   gives each listed place. Every `expected.json` is written by hand from P1, P2, A1–A6 and R1–R2.
2. **Coverage (core unit):** a test asserts at least one case per tag: `root-scalar`,
   `on-key` (A1, key and colon), `on-scalar` (A2, first and after-last offsets), `on-bracket` (A3,
   both brackets, both sides), `between` (A4: spaces, comma, line break, comment), `innermost`
   (A4's tie), `outside` (A5: before, after, BOM), `broken-before` (A6 error before the offset),
   `broken-after` (A6: text after the offset is not read), `nested`, `empty-containers`,
   `shorthand-name`, `quoted-name` (`.`, space, `[`, digits first, `$`, `@`, `*`), `escaped-name`
   (`'`, `\`, `\n`, `\t`, U+0001), `unicode-name` (`é`, `我`, an emoji), `empty-name`,
   `index-like-name` (the name `"0"` beside the index `0`), `pointer-escapes` (`~`, `/`),
   `proto-name` (`__proto__`, `constructor`), `lone-surrogate`, `duplicate-name` (R2),
   `jsonc-comments`, `json5-syntax` (unquoted and single-quoted keys, hex, `Infinity`, trailing
   commas), `jsonl` (items, blank lines, CRLF), `jsonl-blank-line`, `jsonl-bad-line`, `no-place`.
3. **Path text (unit, fast-check, seed committed, 10 000 runs):** for any data the 002 formats can
   hold (names of any string, lone surrogates included, nesting to depth 64) and any path of a node
   in it, reading its P1 text and its P2 text (P3, against that data) gives the path back (P4); P1
   and P2 match their grammars (RFC 9535 §2.7's normalized-path grammar with `.name` added for
   shorthand names; RFC 6901 §3). Engine check, same runs: json-p3 2.3.2 (spec 014's RFC 9535 engine)
   on the P1 text returns exactly the node's value, for every path whose names hold no lone
   surrogate and no U+0000–U+001F other than `\b` `\f` `\n` `\r` `\t` (json-p3 2.3.2 refuses those
   escapes, §Current evidence).
4. **Round trip (unit, fast-check, seed committed, 10 000 runs per format):** for any data written by
   core's `stringify` in `json`, `jsonc` (with comments inserted between tokens), `json5` (unquoted
   and single-quoted keys) and `jsonl`, and every node path `p` in it, `nodeAt(placeOf(p))` is `p`
   (R3); for every offset in the text, `nodeAt` gives a path whose `placeOf` exists. Neither
   function adds an entry to core's parse cache (`releaseParse`'s cache).
5. **Copy in the page (test:web):** on the standalone page, in tree and table mode, S2's "Copy
   JSONPath" and "Copy JSON Pointer" on a value, a key, an array element and a table cell send the
   host one copy request holding that node's P1 or P2 text; a multi-selection of two rows sends
   none and shows S1's message. The navigation bar's edit box shows the selected node's P1 text, its
   copy button sends a copy request with that text, and entering `$.people[0].name`,
   `/people/0/name`, then `$..name` selects `/people/0/name` twice and then shows P3's refusal.
6. **Mode switch (test:web):** selecting `/people/1/a.b` in tree mode and switching to text mode puts
   the text cursor at that member's place (R1); moving the cursor onto `"count"` and switching to
   tree mode selects `/count`; switching to table mode with a cell's node at the cursor selects that
   cell. In a locked large-file tab there is no text mode, and tree ⇄ table keeps the selection.
7. **Commands (e2e):** on the fixtures in `tests/e2e/fixtures/copy-path/` (`.json`, `.jsonc` with
   comments, `.json5`), "Copy JSONPath" and "Copy JSON Pointer" from the command palette, in VS
   Code's text editor with the cursor at each listed offset and in the CHR editor with each listed
   node selected (tree and table mode, and text mode at an offset), leave
   `vscode.env.clipboard.readText()` equal to the expected text, and the document text and version
   unchanged. The text editor's context menu lists "Copy JSONPath", "Copy JSON Pointer" and "Reveal
   in CHR JSON Editor" for those documents and none of them for a `.txt` file.
8. **Reveal (e2e, per UNK-082 ★):** "Reveal in CHR JSON Editor" with the text cursor on a key of a
   collapsed, scrolled-out member leaves one tab on the document, the CHR editor's, active, with
   that member selected in tree mode and its row inside the webview's viewport; with a CHR editor
   tab already open in another group, that tab becomes active and the text tab stays open. "Reveal
   in Text Editor" with a node selected leaves the text editor active with the cursor at the node's
   place and that line in `visibleRanges`. The document text, version and dirty state are unchanged
   by both, and so is the CHR tab's lock state (spec 008).
9. **No node (e2e):** with the cursor after a syntax error in a `.json5` fixture, each S5 command
   shows S6's first message with that error's line and column, copies nothing and changes no tab; a
   text edit that removes the selected node between selection and "Reveal in Text Editor" shows S6's
   second message.
10. **JSON Lines (e2e):** on `tests/e2e/fixtures/copy-path/lines.jsonl`, in the text editor and the
    CHR editor (Table mode, spec 012), the copy commands give `$[i]…` and `/i/…` for item `i` (blank
    lines not counted), the root on a blank line, and S6's message with the line on a bad line; both
    reveals land on the same item and member.
11. **Large files (e2e + bench):** on spec 008's 6 MiB fixture, in a locked large-file tab and in the
    text editor, the copy commands and both reveals work as in criteria 7 and 8, the tab stays locked
    and its text unchanged; above the threshold a progress notification "Finding the node…" shows
    while a command reads the text. `bench/RESULTS.md`, in one run, gives the median `nodeAt` time at
    the last record's last key and the median `placeOf` time of that path on the 5 and 50 MiB bench
    documents per format (`json`, `jsonc`, `json5`, `jsonl`), each at most 25% of the median
    `parse` time of the same document in that run. HYPOTHESIS (sandbox, Node 22.22.0, jsonc-parser's
    `getLocation` as a stand-in for `nodeAt` on json and jsonc): 95–116 ms at 5 MiB and 1.0–1.1 s
    at 50 MiB, 11–12% of `parse`.
12. **Web (web e2e):** in the web extension (spec 013), criterion 7's `.json` case (text editor and
    CHR editor) and "Reveal in CHR JSON Editor" pass on the virtual file system, and spec 013's
    command coverage map lists the four commands.
13. **Offline and licenses:** no new runtime dependency (core keeps using jsonc-parser's scanner and
    its own JSON5 parser; json-p3 is already shipped for spec 014, and the path code does not need
    it); `pnpm check:offline` and `pnpm check:licenses` pass with no new entry.

## Where we differ from jsoneditoronline.org
- The site's editor library (vanilla-jsoneditor 3.13.0, checked on our standalone page) writes the
  navigation bar's path in its own notation, `people[1]["a.b"]`, and reads key `"0"` and index `0`
  the same way (`[0]`). Ours shows and reads JSONPath, and reads JSON Pointer too (S3).
- The library has no "copy path" in its context menus and no navigation bar in text or table mode;
  ours copies from every mode and from VS Code's text editor (S2, S5).
- The library forgets the place when the mode changes; ours keeps it (S4). We checked the library
  version we ship, not the live site, which may run a newer one.
- "Reveal" between a text view and the tree is ours: the site has one editor per panel.

## Scope
- **In:** core's path text (P1–P4) and locating (A1–A6, R1–R3) for `json`, `jsonc`, `json5` and
  `jsonl`; the corpus, coverage test and property suites; S1–S6 in the CHR JSON editor (tree, table
  and text mode, the library's context menus and navigation bar, the mode switch) and in VS Code's
  text editor; the four commands, their menus and context keys; the webview messages they need
  (copy, the current node's path, reveal; one protocol bump); JSON Lines; locked large-file tabs and
  the bench rows; the web e2e case; the README line.
- **Out:** other path notations (the library's own, JavaScript `data.people[1]`, Lodash `_.get`
  strings, JSON Schema `$ref` URI fragments); copying a path from the compare panel (007) or the CSV
  preview (009); revealing a node in a compare diff; paths of several nodes at once; a "Go to path…"
  input box outside the navigation bar; default keybindings (019 settings can add them); revealing
  from VS Code's Problems panel or outline; editing a node's key or value from its path; the Chrome
  app (020), which can reuse core's functions and the page's menu items.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md:21` (library: "Breadcrumb navigation bar with editable
  path (JSONPath or JSON Pointer)") and `:116` (P2 "Copy path as JSONPath or JSON Pointer, reveal
  node from text cursor", Library + ours, S); `spec/INDEX.md` backlog item 018; spec 014 §Scope Out
  ("copying a node's path as an RFC 9535 normalized path or editing the breadcrumb as JSONPath
  (018)").
- Site: jsoneditoronline.org/features/ and /docs/ (fetched 2026-10-13) say nothing about copying a
  path, the navigation bar, JSONPath or JSON Pointer paths, or keeping the place between modes; the
  only locating text is "Clicking in the list with issues at the bottom will scroll to the location
  of the issue in the document." The docs say the two panels "can be edited independently of each
  other".
- Library (vanilla-jsoneditor 3.13.0, `index.d.ts`): `navigationBar` and `pathParser: {parse,
  stringify}` props (`:493`, `:502`, `JSONPathParser` `:20-23`), `onRenderContextMenu` (`:337`,
  `:511`), `select` (`:765`), `scrollTo(path)` (`:771`), `TextSelection` with offset ranges
  (`:171-178`), `stringifyJSONPath`/`parseJSONPath` (`:1095`, `:1099`). Its path editor refuses a
  path not in the data with "Path does not exist in current document" and has a copy button titled
  "Copy selected path to the clipboard" (`index.js`, the `NavigationBarPathEditor` component).
- Sandbox check on our standalone page (2026-10-13, `pnpm build`, Playwright with Chromium, a
  throwaway spec not committed): tree mode has a navigation bar, table and text mode have none; with
  `/people/1/a.b` selected the edit box shows `people[1]["a.b"]` and the copy button copies that;
  entering `people[0].name` selects `/people/0/name`; the tree context menu has Edit key, Edit
  value, Enforce string, Cut (formatted, compacted), Copy (formatted, compacted), Paste, Duplicate,
  Extract, Sort, Transform, Remove, Structure, Insert before/after, and no path entry; after
  switching tree → text with `/people/1/name` selected the text has no selection and the cursor is
  on line 1; with the cursor on `"count"`, switching text → tree selects the root, not `/count`.
  `stringifyJSONPath(["0"])` and `stringifyJSONPath([0])` both give `[0]`.
- JSONPath engines (sandbox, 2026-10-13, 32 paths with the names in criterion 2's tags): json-p3
  2.3.2 returns exactly the node for the shorthand and the normalized form of every path but one,
  and the two forms always agree (UNK-081); it refuses `$['\u0001']` with "invalid character"
  (likewise `\u001f`), though RFC 9535 §2.7 requires that escape, while `\b`, `a` and `é`
  work. jsonpath-plus 10.4.0 (JSONPath (Goessner), spec 011) misses 10 of the 32 (names holding
  `'`, `\`, `$`, `@`, `*`, `..`, `[`, a tab, a line feed or U+0001), so criterion 3 checks RFC 9535
  only, as the query language a copied path is meant for.
- Size (sandbox, Node 22.22.0, `bench/generate.mjs` documents): jsonc-parser 3.x `getLocation` at the
  last record's `zip` key takes 116 / 95 ms (json / jsonc) at 5 MiB and 1,143 / 1,003 ms at 50 MiB;
  scanning every token of the 50 MiB documents takes 410–657 ms. `parse` takes 9,273 / 8,217 /
  6,420 / 3,653 ms (json / jsonc / json5 / jsonl) and keeps 1.4–2.1 GB at 50 MiB
  (`bench/RESULTS.md:58-130`), so locating must not build the tree. jsonc-parser misreads JSON5
  (unquoted keys give the path `[69783, ""]`), so `json5` needs core's own JSON5 tokens.
- Core today: `packages/core/src/formats/pointer.ts:5-20` (`parsePointer`, `parseIndex`, RFC 6901),
  `tokens.ts:34-62` (`tokenize` from jsonc-parser's scanner, `tokenAt`), `json5-parser.ts:59-77`
  (`parseJson5` with tokens and tree; `parseJson5Data`), `types.ts:28-34` (`FormatNode` offsets),
  `jsonl-adapter.ts:60-70` (`classify`, `split`), `parse-data.ts` (`parseData`).
- Webview today: `packages/app-shell/src/App.svelte:262-279` (the library's props:
  `onRenderContextMenu`, `onSelect`; no `pathParser`, so the default), `:351-364`
  (`renderContextMenu` routes Transform), `Compare.svelte:191-194` (`select` + `scrollTo` with
  `expand` to reveal a path, spec 007), `editorProvider.ts:465-492` (`rowSource`: the host asks the
  page for its selected node, spec 009 criterion 7, the pattern the copy commands reuse).
- Commands and menus: `packages/vscode-extension/package.json` `contributes.commands`,
  `menus.commandPalette`, `menus.editor/title` (`chrJsonEditor.openInEditor`,
  `chrJsonEditor.reopenAsText`; context keys `chrJsonEditor.customEditorFormat`,
  `chrJsonEditor.textEditorFormat`, `chrJsonEditor.customEditorLocked`); `src/commands.ts`
  (`swapEditor`, UNK-016's note on `tabGroups.close`).
- VS Code's own: its JSON language features give json and jsonc documents an outline and breadcrumbs
  (document symbols), with no command to copy a node's path, and nothing for json5 or jsonl, which
  VS Code has no built-in language for. Inferred from VS Code's documented JSON features, not
  checked on an installed VS Code in this sandbox.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-080 | Which path notations the copy commands offer | S2, S5, criteria 3, 5, 7; T2, T3 | ★ JSONPath and JSON Pointer, two commands · JSONPath only · JSON Pointer only |
| UNK-081 | JSONPath spelling: `.name` shorthand where allowed, or always `['name']` | P1, criteria 1–3; T1 | delegated: shorthand if criterion 3's engine check finds both forms give the same node (sandbox: they do) |
| UNK-082 | Where a reveal shows the other editor | S5, criterion 8; T3 | ★ The document's open tab of that editor, else in place of the current tab · Beside, in a split |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [ ] Human approval recorded
