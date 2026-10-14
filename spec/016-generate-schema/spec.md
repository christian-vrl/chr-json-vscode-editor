# SPEC 016 — Generate JSON Schema

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidEKL4N1bAgegHusPXenRPF6, 2026-10-13)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Spec 004 validates a document against a JSON Schema, but only if the user already has one. Writing
a schema by hand for an existing file (an API response, a config, an export) is slow: every key,
every nested object, which keys every item has. Today a user who wants validation for such a file
has to paste it into an online generator, which sends the data off the machine, the opposite of
what this extension promises. The feature map lists "Generate JSON Schema from a document" as P2,
our own work (`docs/research/feature-map.md:114`).

## Goal
One command turns the open document into a JSON Schema that the document itself passes, written
offline to a file beside it, and (per UNK-070) linked to the document in one click so spec 004
validates it from then on.

## Terms
- **Generator:** `generateSchema(data, dialect)` in `packages/core/src/schema/generate.ts`, pure
  TypeScript (no DOM, no Node API), our own code with no new dependency.
- **Dialect:** the JSON Schema dialect the schema is written in, per UNK-069 (★ draft-07), named by
  its `$schema` URI as spec 004's validator registers it (`http://json-schema.org/draft-07/schema#`
  or `https://json-schema.org/draft/2020-12/schema`). The command writes draft-07 (UNK-069); the
  generator also takes 2020-12, which the corpus and criterion 3 cover.
- **Source data:** core's `parseData(format, text)` (spec 008) of the document's text when the
  command runs, in the format its badge shows. A text whose `parseData` gives `{ error }` has no
  source data.
- **Schema file:** the generated schema as text: `JSON.stringify(schema, null, 2)` followed by
  `\n`.
  *Amended by spec 019 (owner approval card cmsg_01Wz9SKzwQD2da69nuNGPcidLLV2o7v38WLuAiuBG8p2cr, 2026-10-14; AGENTS rule 7), UNK-088: where this says 2 spaces, the indent unit is VS Code's `editor.tabSize` and `editor.insertSpaces` for the language (spec 019 I1); core's default stays 2 spaces.*
- **Threshold** and **ceiling:** spec 008's 5 MiB (5,242,880 bytes of UTF-8 text when the command
  runs) and 52,428,800 UTF-16 code units.

## Generation rules (the corpus encodes these)
- **G1 Type of a value:** `null` → `"null"`; `true`/`false` → `"boolean"`; a string → `"string"`;
  a number → `"integer"` when `Number.isInteger(n)` (so `-0` and `1e300` are integers), otherwise
  `"number"` (so `NaN`, `Infinity` and `-Infinity`, which JSON5 can hold, are numbers); an array →
  `"array"`; any other object → `"object"`. A big number (spec 015) is typed by its nearest number,
  the value spec 004's validator sees (015 B6).
- **G2 One schema for many values:** a schema describes a set of values (the root's set is the
  document's data alone). Its `type` is the set of their types: a single string for one type, else
  an array in the fixed order `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`.
  When both `number` and `integer` occur, only `number` is written (every integer is a number).
- **G3 Objects:** when the set has objects, `properties` holds every key any of them has, in the
  order keys are first met (document order, depth first), each with the G2 schema of that key's
  values across those objects; `required` lists, in `properties` order, the keys every one of those
  objects has. An empty `properties` or `required` is not written. `additionalProperties` is not
  written (the schema stays open). A key is an own key: `__proto__`, `constructor` and `$ref` are
  ordinary keys.
- **G4 Arrays:** when the set has arrays, `items` is the G2 schema of all their elements together
  (one schema for every position; no tuples); it is not written when every array is empty.
- **G5 Nothing else:** no `format`, `enum`, `const`, `pattern`, length or range keywords, no
  `title`, `description`, `examples` or `$id`. The schema says which keys exist and what types
  they hold, and nothing the sample might hold by chance.
- **G6 Key order in the schema:** `$schema` (root only), `type`, `properties`, `required`, `items`.
- **G7 Formats:** comments, trailing commas, quoting and every other JSONC or JSON5 syntax play no
  part: the schema depends only on the source data, so the same data in `json`, `jsonc` and `json5`
  gives the same schema file byte for byte.
- **G8 JSON Lines:** for a `jsonl` document the schema describes one line: it is G2's schema of the
  set of all items (with `$schema` first). An empty `jsonl` document gives `{ "$schema": … }` alone.
- **G9 Depth:** data nested more than 1,000 levels deep is not generated; the message is "The
  document is nested too deeply to generate a schema (more than 1,000 levels)."

## Acceptance criterion (falsifiable)
1. **Corpus (core unit):** for every case in `tests/schema-gen/<case>/` (`input.<ext>` with ext in
   `json`, `jsonc`, `json5`, `jsonl`; `case.json` with `format`, `dialect` and `tags`;
   `expected.schema.json`), the schema file of `generateSchema(parseData(format, input), dialect)`
   is byte-equal to `expected.schema.json`, or (`too-deep`) the G9 error. Every
   `expected.schema.json` is written by hand from G1–G9.
2. **Coverage (core unit):** a test asserts at least one case per tag: `scalar-root` (one per JSON
   type), `integer`, `number-merge` (integers and decimals together), `minus-zero`, `nan`,
   `infinity`, `mixed-types`, `nullable` (a key that is sometimes `null`), `required-all`,
   `required-partial` (an array of objects missing some keys), `nested`, `array-of-arrays`,
   `empty-array`, `empty-object`, `object-or-scalar` (array items mixing objects and scalars),
   `key-order`, `proto-key` (`__proto__`, `constructor`, `toString`), `schema-keyword-key` (keys
   named `$ref`, `type`, `properties`), `unicode-key`, `jsonc-comments`, `json5-syntax` (hex,
   unquoted keys, single quotes, `Infinity`), `same-data` (G7: one data, three formats, one
   expected file), `jsonl`, `jsonl-empty`, `too-deep`, `dialect-draft-07`, `dialect-2020-12`.
3. **The source passes its schema (unit, fast-check, seed committed, 10 000 runs per dialect):** for
   any data the 002 formats can hold (JSON5 values with `-0`, `NaN`, `±Infinity`, objects with any
   keys including `__proto__`, `constructor` and `$ref`, nesting to depth 64), spec 004's
   `compileSchema(generateSchema(data, d))` compiles in dialect `d` (not "assumed"), the schema is
   valid against `d`'s meta-schema, and validating `data` gives no errors. Tightness, same runs:
   deleting a key that the schema lists in `required` from an object in the data gives a `required`
   error at that object's path, and putting `true` where the schema's `type` is `"string"` gives a
   `type` error at that path.
4. **Inherited keys (unit; amends spec 004 criterion 2, see §Changes):** spec 004's validator
   created with `ownProperties: true` reports exactly one error, `required` at `""`, for the schema
   `{"properties": {"constructor": {"type": "null"}, "toString": {"type": "string"}}, "required":
   ["hasOwnProperty"]}` on `{}` (before T2, as on `main` @ 0b67093, it reports two `type` errors and no
   `required` one), and every `tests/schema/` fixture gives the same errors as before.
5. **Command (e2e):** "Generate JSON Schema" (`chrJsonEditor.generateSchema`) runs from the command
   palette and the editor-title menu, in the CHR JSON editor and in the text editor, for `.json`,
   `.jsonc` and `.json5` fixtures in `tests/e2e/fixtures/generate-schema/`. It writes
   `<name>.schema.json` beside the source (`data.json5` → `data.schema.json`) byte-equal to the
   fixture's `expected.schema.json`, and opens it in the editor the command ran from; the source's
   text and file are unchanged. When that file exists, a save dialog opens prefilled with that
   name, and "Cancel" creates and changes no file. A source with no file on a writable file system
   (untitled, `git:`) gives a new untitled JSON document holding the schema file instead.
6. **Broken source (e2e):** a document with no source data is not generated: the message is
   "CHR JSON Editor: can't generate a JSON Schema: the document is not valid `<format>` (error at
   line `l`, column `c`). Fix it or run "Repair JSON" first.", and no file or document changes
   (spec 006 criterion 7's wording).
7. **Link (e2e, per UNK-070 ★):** after writing, the notification reads "Generated
   `<schema name>` from `<name>`." and, when the document has no schema today (spec 004 criterion
   1's resolver finds none) and lies in a workspace folder, has a button "Use for `<name>`".
   Clicking it appends `{"fileMatch": ["/<path>"], "url": "./<schema path>"}` (both relative to the
   folder, `/` separators) to that folder's `json.schemas` setting, keeping existing entries;
   the open document is then validated against the new schema with no errors (004 inline errors,
   none shown). There is no button for an untitled or `jsonl` document, one outside every
   workspace folder, or one that already has a schema.
8. **JSON Lines (e2e):** on `tests/e2e/fixtures/generate-schema/lines.jsonl`, in the text editor
   and the CHR JSON editor, the command writes `lines.schema.json` per G8, byte-equal to its
   expected file.
9. **Large files (e2e + bench):** in a locked large-file tab (spec 008) the command works the same,
   reads the text with `parseData` and leaves the tab locked and its text unchanged; above the
   threshold a progress notification "Generating JSON Schema…" shows while it runs. `bench/RESULTS.md`,
   in one run, gives the median `generateSchema` time on the 5 and 50 MiB json bench documents,
   each at most the median `parseData` time of the same document in that run. HYPOTHESIS (sandbox
   prototype, Node 22.22.0, records of 8 keys): 22 ms at 5 MiB and 169 ms at 50 MiB.
10. **Web (web e2e):** in the web extension (spec 013) the criterion 5 `.json` case passes on the
    virtual file system, and spec 013's command coverage map lists the command.
11. **Offline and licenses:** no new runtime dependency; the only URIs the generator writes are the
    two `$schema` URIs already in `offline-allowlist.txt`; `pnpm check:offline` and
    `pnpm check:licenses` pass with no new entry.

## Where we differ from jsoneditoronline.org
- The site has no schema generator: its docs and features page cover validation against a schema
  the user supplies (pasted, linked by URL, or the other panel), and nothing that infers one
  (§Current evidence). This is our own addition, offline like the rest.
- Online generators send the data to a server; ours never leaves the machine.

## Scope
- **In:** the generator (G1–G9) in `core`; the corpus, coverage test and property suite; spec 004's
  `ownProperties: true`; the command, its menus and context keys, the schema file beside the
  source, the save-dialog and untitled fallbacks, the broken-source message, the link button per
  UNK-070; JSON Lines; large-file tabs and the bench rows; the web e2e case; the README line.
- **Out:** `format`, `enum`, ranges and the rest of G5 (a later spec may add an options dialog);
  merging several files into one schema; detecting map-like objects (`{"id1": {…}, "id2": {…}}`
  gives one property per key); `$defs` and shared sub-schemas; tuples; a schema for a selected node
  (the whole document only); adding `$schema` into the source document; updating a schema from a
  changed document; generating TypeScript or other types; the Chrome app (020), which can reuse the
  core generator.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md:114` (P2 "Generate JSON Schema from a document",
  Ours, M); `spec/INDEX.md` P2 backlog item 016; spec 004 §Scope Out "schema generation (016)".
- Site: jsoneditoronline.org/features/ and jsoneditoronline.org/docs/ (fetched 2026-10-12): the
  features page's JSON Schema text is validation only ("Using Ajv, a JSON Schema validator, you can
  also validate whether the structure of your JSON document is correct"); the docs' Schema section
  ("A JSON schema document can be specified in Document Properties > Schema > Configure"; paste,
  URL, other panel, saved document); neither page contains "generate" or "infer".
- Validator today: `packages/vscode-extension/src/validation.ts:41-47` (`META_SCHEMA`, the `$schema`
  URIs), `:57-79` (`selectDialect`), `:86-133` (`compileSchema`, options `{ strict: false,
  allErrors: true }` at `:90`). `offline-allowlist.txt:40-41` and `:84` already hold the draft-07
  and 2020-12 URIs.
- Inherited-key bug (sandbox check 2026-10-12, Ajv 8.20.0 from the repo's lockfile): with spec
  004's options, `{"properties": {"constructor": {"type": "null"}, "toString": {"type":
  "string"}}}` on `{}` reports "/constructor must be null" and "/toString must be string": Ajv
  reads `data.constructor`, which every object inherits. `ownProperties: true` makes it check own
  keys only (no errors). The generator writes such properties whenever a document has those keys,
  so criterion 3 fails without it; any user schema naming them is affected today.
- Prototype (sandbox, Node 22.22.0, 40 lines, `scratchpad` only): G1–G4 and G6 on fast-check data
  (3,000 runs, seed 42, the criterion 3 generator) self-validate with Ajv `draft-07` and `2020-12`
  once `ownProperties: true` is set; the first counterexample without it was an object without a
  `constructor` key in an array whose other objects had one. Time: 36,010 records (5 MiB) 22 ms,
  351,126 records (50 MiB) 169 ms; `JSON.stringify` plus `JSON.parse` of the 50 MiB data 2.4 s.
- Data and sizes: `packages/core/src/formats/parse-data.ts:14-19` (`parseData`, error with offset;
  `jsonl` gives the array of items, `:22`); spec 008 criteria 2, 6, 9; spec 012 L1.
- Output and messages to match: spec 006 criterion 6 and UNK-035 (owner, "New file beside it":
  the converted file beside the source, a save dialog when it exists, opened in the editor the
  command ran from); `packages/vscode-extension/src/convertPlan.ts:68-75` (`brokenMessage`).
- Association: `packages/core/src/schema/association.ts:103-139` (`fileMatchSelects`: a pattern
  matches any trailing part of the URI, a leading `/` is dropped), `:139-162` (workspace-folder
  scope), `:188-200` (`settingUrl`: a `url` starting with `.` resolves against the folder); `json.schemas` comes before
  `json5.schemas` (004 criterion 1), so one `json.schemas` entry serves `.json5` files too.
- Big numbers: spec 015 B6 (approved, on `main` since #91): Ajv sees each big number's nearest
  number, so G1 types it the same way and criterion 3 holds for big numbers.
- Commands and menus: `packages/vscode-extension/package.json` `contributes.commands`,
  `menus.commandPalette`, `menus.editor/title` (the convert commands' `when` clauses with
  `chrJsonEditor.customEditorFormat` and `chrJsonEditor.textEditorFormat`).

## Changes to approved specs (AGENTS rule 7; approved with this spec on the approval card, which named the old and new wording)
- **004 criterion 2** "Ajv runs with `strict: false`, `allErrors: true`, and `ajv-formats` added" →
  "Ajv runs with `strict: false`, `allErrors: true`, `ownProperties: true`, and `ajv-formats`
  added". Effect: `properties`, `required` and the other keyword checks look at a document's own
  keys only, so a schema naming `constructor` or `toString` no longer reports errors on objects
  that lack them.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-069 | Which dialect the generated schema is written in | G1–G9's `$schema`, criteria 1–3; T1 | resolved (owner): ★ draft-07 |
| UNK-070 | Whether the notification offers to link the schema to the document | criterion 7; T3 | resolved (owner): ★ "Use for `<name>`" button |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded
