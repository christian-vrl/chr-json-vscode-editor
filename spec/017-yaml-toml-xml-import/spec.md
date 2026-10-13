# SPEC 017 — YAML, TOML and XML import

> **Status:** `approved (owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcidHnJ7WptLzuHMPNwoMzSPwC, 2026-10-13)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Much of the structured data people keep next to their JSON is not JSON: YAML for CI pipelines,
Kubernetes and Docker Compose, TOML for `Cargo.toml` and `pyproject.toml`, XML for Maven, Android,
SOAP and many exports. To use the tree, table, query, compare or schema tools of CHR JSON Editor
on such a file, a user today pastes it into an online converter, which sends the data off the
machine, the opposite of what this extension promises. The feature map lists "Convert YAML, TOML,
XML to JSON on open" as P2, our own work (`docs/research/feature-map.md:115`). jsoneditoronline.org
has no YAML, TOML or XML support at all (§Current evidence), so this spec follows spec 009's CSV
import, the closest flow we have.

## Goal
A YAML, TOML or XML file becomes JSON in one command, offline: written as a new `.json` file beside
it and opened in the CHR JSON editor, or imported into the open document as one undoable edit,
with every number kept exactly (spec 015) and a warning for each thing JSON cannot hold.

## Terms
- **Kind:** `yaml` (files `*.yaml`, `*.yml`), `toml` (`*.toml`) or `xml` (`*.xml`). The kind comes
  from the command or the file's extension, never from content detection; spec 002's detection and
  the CHR JSON editor's file associations are unchanged (none of these files opens as a document
  in the CHR JSON editor).
- **Importer:** `importData(text, kind)` in `packages/core/src/import/`, exported from
  `@chr-json-editor/core` (ADR-015). It returns `{ data, warnings }` or `{ error }`. A warning and an error
  carry a message and a 1-based line (an error also a 1-based column, when the parser gives one).
- **Output text:** `stringify(data, 'json', OUTPUT_STYLE)` (spec 002 R8, spec 015 B2), where
  `OUTPUT_STYLE` is 2-space indent, `\n` line endings, a final newline, double quotes, quoted keys
  and no trailing commas.
- **Big number, decimal text, big number value:** as spec 015 §Terms (ADR-014).
- **Size, threshold, ceiling:** as spec 008: the UTF-8 length of the file's text when the command
  runs; 5 MiB (5,242,880 bytes, UNK-014); VS Code's 50 MB sync limit (008 criterion 9).
- **YAML limit:** the largest YAML file the importer reads, set by UNK-077 (delegated).
- **Locked:** a CHR JSON editor tab in spec 008's read-only large-file mode not yet unlocked with
  "Edit anyway" (UNK-040).

## Rules for every kind (the corpus encodes these)
- **A1 Text:** UTF-8; a leading BOM is removed. A file that starts with a UTF-16 or UTF-32 BOM, or
  an XML declaration naming any encoding other than UTF-8 (any case), is an error ("Only UTF-8
  files can be converted").
- **A2 Numbers:** an integer keeps its exact value: its decimal digits (hexadecimal, octal and
  binary forms written in decimal, a leading `+` dropped, TOML's `_` separators removed) give a
  JavaScript `number` when it is not a big number, else its big number value (015 B1). A YAML
  non-integer is read the same way from its decimal text (`.5` → `0.5`, `5.` → `5`, a leading `+`
  dropped), so `0.1000000000000000000001` and `1e400` keep their digits. XML text is a number only
  when XM6 says so, and then its text already is its decimal text (`.5`, `5.` and `+1` stay
  strings there). TOML floats are IEEE 754 binary64 values, as TOML 1.0.0 defines them (TM3).
- **A3 Non-finite numbers:** YAML's `.inf`, `-.inf`, `.nan` (any case form YAML allows) and TOML's
  `inf`, `+inf`, `-inf`, `nan`, plus any TOML float that overflows binary64, become `null`, each
  with a warning naming its path and line ("`<path>`: `<value>` has no JSON form; written as
  null"), as UNK-034 decided for JSON5's `Infinity` and `NaN`.
- **A4 Keys:** every key is an own member, `__proto__` and `constructor` included. Key order is the
  order in the file (first occurrence), except where a rule below says otherwise.
- **A5 Depth:** data nested more than 1,000 levels deep is an error ("The file is nested too deeply
  to convert (more than 1,000 levels)"), with no stack overflow. YAML data nested more than 500 levels
  deep, and at most 1,000, is an error ("The YAML file is nested too deeply to convert (more than
  500 levels)"): `yaml` 2.9.1's composer recurses about 1.3 KB of stack per level, overflows Node
  22's default stack near 780 levels, and V8 can then abort the whole process while it compiles a
  regular expression, so the importer checks the depth before the composer runs (017 T2).
- **A6 Comments and layout** are not carried: JSON has none. No warning is given for them; the
  source file is never changed.

## YAML rules (`yaml` 2.9.1)
- **Y1 Version:** YAML 1.2 with the core schema, so `on`, `yes`, `no`, `y` and `n` are strings and
  `0777` is the integer 777. A document that starts with `%YAML 1.1` uses YAML 1.1's rules (`on`,
  `yes`, `y` → `true`; `0777` → 511; `1_000` → 1000), except that a 1.1 timestamp stays the string
  as written.
- **Y2 Documents:** one document gives its value; a text with no document (empty, or only
  comments and directives) gives `null`; several documents give an array of their values in order,
  with one warning ("The file holds `<n>` YAML documents; they became one array"), on the line of
  the second document.
- **Y3 Scalars:** strings as YAML defines them (quoting, escapes, block scalars, folding); `null`,
  `~` and an empty value → `null`; `true`/`false` (core schema forms) → booleans; numbers per A2
  and A3.
- **Y4 Keys:** a string key as its value; any other scalar key as its text in the file (`1.0: a` →
  `"1.0"`, `~: a` → `"~"`, `true: a` → `"true"`); a collection key as its one-line JSON text, with a
  warning. A repeated key keeps the last value, in the first one's position, with a warning naming
  the repeated key's line.
- **Y5 Merge keys:** `<<: *anchor` and `<<: [*a, *b]` merge the anchored mappings' members into the
  mapping, in both YAML versions, as Docker Compose and GitLab CI expect: members written in the
  mapping win, then earlier merged mappings over later ones.
- **Y6 Anchors and aliases:** an alias gives a copy of the anchored value. When aliases would add
  more than 1,000,000 values in all to the data, the conversion is an error ("The YAML file's
  aliases expand too far"), so a "billion laughs" file fails fast instead of filling memory.
- **Y7 Tags:** the core schema's tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!map`,
  `!!seq`) apply. Any other tag (`!Ref`, `!Sub`, `!GetAtt` in CloudFormation, `!!binary`, `!!set`,
  `!!omap`, `!!timestamp`) is ignored: the value is read as if untagged, with one warning per
  distinct tag naming its first line ("Tag `<tag>` was ignored (`<n>` places)").
- **Y8 Errors:** a text the YAML 1.2 grammar rejects is an error with the line and column of the
  first problem the parser reports.

## TOML rules (`smol-toml` 1.9.0, TOML 1.0.0)
- **TM1 Tables:** the root table, every table, array of tables and inline table becomes an object;
  arrays become arrays. Members are in the order the parser defines them (first definition).
- **TM2 Integers:** per A2. TOML integers are 64-bit, so one outside ±(2^53 − 1) becomes a big
  number value; a value outside the 64-bit range is an error, as TOML 1.0.0 requires.
- **TM3 Floats:** binary64 values written as spec 002 R8 writes numbers; non-finite ones per A3.
- **TM4 Dates and times:** a string in RFC 3339 form with a `T` separator and milliseconds, as
  `smol-toml`'s `TomlDate.toISOString()` writes it: offset date-time `1979-05-27T00:32:00.999-07:00`
  (UTC as `Z`), local date-time `1979-05-27T07:32:00.000`, local date `1979-05-27`, local time
  `07:32:00.000`. Digits past milliseconds are cut, as TOML 1.0.0 allows ("additional precision
  must be truncated").
- **TM5 Errors:** a text TOML 1.0.0 rejects (a duplicate key, a table defined twice, a bad value)
  is an error with the parser's line and column.

## XML rules (`saxes` 6.0.0, our mapping; shape and value types per UNK-075 ★ "Compact")
- **XM1 Document:** the result is an object with one member, named after the root element, holding
  its value. The XML declaration, DOCTYPE, comments and processing instructions are not carried.
- **XM2 Element value:** an element with no attributes and no child elements is its text (XM4,
  then XM6); an empty element (`<a/>`, `<a></a>`) is `""`. Any other element is an object holding,
  in this order: its attributes as `@<name>` members in document order, its child elements as
  members named after them in order of first appearance, and `#text` when it has text (XM4).
- **XM3 Repeated elements:** child elements with the same name are one member holding an array of
  their values in document order; a name that appears once is a single value. When children with
  different names interleave (`<a/><b/><a/>`), their relative order is lost, with one warning
  naming the parent's line.
- **XM4 Text:** character data and CDATA sections are joined in order, then leading and trailing
  white space (space, tab, CR, LF) is removed. In an element with child elements, text that is only
  white space is dropped; other text there (mixed content, such as `<p>Hi <b>you</b>!</p>`) becomes
  `#text` with its runs joined by one space, with one warning naming the element's line, since its
  place among the children is lost.
- **XM5 Names:** element and attribute names as written, prefixes included (`soap:Envelope`,
  `@xmlns:soap`); namespaces are not resolved. XML names cannot start with `@` or `#`, so no member
  clashes with an attribute or `#text`.
- **XM6 Values:** a text or attribute value becomes a number when it is an RFC 8259 number and either
  `JSON.stringify(Number(text)) === text` or it is a big number (then its big number value); `true`
  and `false` become booleans; anything else stays a string (`007`, `1.50`, `1e3`, `null`, `""`).
  This is spec 009 I7's "Exact" rule (UNK-043, UNK-067) for unquoted cells, without its `null` and
  JSON-text cases.
- **XM7 Entities:** the five predefined entities and character references are decoded. Any other
  entity reference is kept as written (`&nbsp;`) with one warning per distinct name; entities
  declared in a DOCTYPE are never expanded and nothing outside the file is ever read (no external
  DTD, no XInclude), so entity bombs and external-entity attacks do nothing.
- **XM8 Errors:** a text that is not well-formed XML (an unclosed or mismatched tag, two roots, a
  bad name, text outside the root) is an error with the parser's line and column.

## Acceptance criterion (falsifiable)
1. **Golden (core unit):** for every case in `tests/golden/import/<kind>/<case>/` (`input.<ext>`,
   `case.json` with `rules` and `tags`, and either `expected.json` with `warnings.json` or
   `error.json`), the output text of `importData(input, kind).data` is byte-equal to
   `expected.json` (so big numbers are checked digit for digit) and `warnings` equals
   `warnings.json` (`[{message, line}]`, in order), or the error equals `error.json`. Every
   `expected.json` is written by hand from the rules above.
2. **Coverage (core unit):** a test asserts at least one case per rule A1–A5, Y1–Y8, TM1–TM5 and
   XM1–XM8, and per tag: `big-integer`, `big-decimal` (YAML and XML), `hex-octal-binary`,
   `non-finite`, `proto-key`, `too-deep` (one per kind), `bom`, `utf16-bom`, `yaml-1.1-booleans`,
   `yaml-github-actions-on` (an `on:` key stays `"on"`), `yaml-multi-document`, `yaml-empty`,
   `yaml-merge-key`, `yaml-alias-bomb`, `yaml-cloudformation-tags`, `yaml-duplicate-key`,
   `yaml-complex-key`, `toml-dates` (all four kinds), `toml-array-of-tables`, `toml-int64-overflow`,
   `xml-attributes`, `xml-repeated`, `xml-interleaved`, `xml-mixed-content`, `xml-cdata`,
   `xml-namespaces`, `xml-entity-bomb`, `xml-external-entity`, `xml-encoding-latin1`,
   `xml-empty-element`, and one malformed input per kind.
3. **Round trip (core unit, fast-check, seed committed, 10 000 runs per kind):** for `data` from
   spec 002's JSON data generator (numbers as JavaScript `number`s; big numbers are the corpus's
   job, since neither library writes a `LosslessNumber`),
   `importData(yamlText, 'yaml')` with `yamlText` = `yaml` 2.9.1's `stringify(data)` gives no
   warnings and data equal to `data` (spec 015 §Terms equality, key order checked); for `data`
   restricted to what TOML holds (an object at the root, no `null` at any depth, integers within
   64 bits, finite numbers), the same holds for `smol-toml`'s `stringify`.
4. **Hostile input (core unit):** for any string (fast-check, 10 000 runs per kind) `importData`
   returns, never throws; the `yaml-alias-bomb` case (nine levels of nine aliases) gives Y6's error
   in under 1 s; the `xml-entity-bomb` case (a DOCTYPE "billion laughs") returns in under 1 s with
   XM7's warning and no expansion; 100,000 nested `[` (YAML), arrays (TOML) and elements (XML) give
   A5's error with no stack overflow.
5. **Convert (e2e):** "Convert YAML to JSON", "Convert TOML to JSON" and "Convert XML to JSON"
   (`chrJsonEditor.convertYamlToJson`, `…TomlToJson`, `…XmlToJson`) run from the explorer context
   menu and the text editor's title menu on files of their kind, and from the command palette on
   the active editor's file of that kind (else an open dialog filtered to that kind). Each writes
   `<name>.json` beside the source (`config.yaml` → `config.json`, `Cargo.toml` → `Cargo.json`),
   byte-equal to the fixture's `expected.json` in `tests/e2e/fixtures/import/`, and opens it in the
   CHR JSON editor. When that file exists, a save dialog opens prefilled with its name, and
   "Cancel" writes nothing (UNK-035). A source with no file on a writable file system (untitled,
   `git:`) gives a new untitled JSON document holding the output text. The source's text and file
   are never changed.
6. **Import into a document (e2e, per UNK-042's "Both"):** "Import YAML, TOML or XML…"
   (`chrJsonEditor.importFile`; command palette and the CHR JSON editor's title menu) picks a file
   in an open dialog filtered to the three kinds, then asks "Replace the data of `<document>` with
   the data of `<file>`? Comments on members that stay are kept." with "Replace" and "Cancel".
   "Replace" applies the data as `diff(old, new)` → JSON Patch → `applyPatch` (002 R14) in one
   `WorkspaceEdit`: on `tests/import/replace/*` the text equals `expected-after.*` byte for byte,
   the document is dirty, and one undo restores its text exactly. "Cancel" changes nothing. In a
   JSON Lines tab (spec 012) the data must be an array (its items replace the lines, as 012
   criterion 11 does for CSV); any other value gives "JSON Lines needs an array; `<file>` holds
   `<type>`." and no change.
7. **Errors and warnings (e2e):** for a malformed fixture of each kind, the error message is
   "CHR JSON Editor: can't convert `<file>`: `<message>` (line `l`, column `c`)." and no file or
   document changes. When the conversion has warnings, the notification "Converted `<file>` with
   `<n>` warnings." has a "Show Warnings" button that opens the output channel "CHR JSON Editor"
   listing each as "`<file>`:`<line>`: `<message>`".
8. **Size (e2e):** a TOML or XML file above the threshold converts in full under a progress
   notification "Converting `<file>`…"; a created JSON file above the threshold opens as spec 008
   says (large-file mode), and one above the ceiling is still written and opening it shows 008
   criterion 9's message. A file above the ceiling, or a YAML file above the YAML limit, is not
   read: the message says "`<file>` is too large to convert (`<size>`; the limit for `<kind>` is
   `<limit>`)."
9. **Large-file tabs (e2e):** in a locked tab "Import YAML, TOML or XML…" is not offered (title
   menu and palette); it comes back after "Edit anyway". The convert commands are not affected.
10. **Speed and memory (bench):** `bench/RESULTS.md` gives, from one CI run, the median of 3
    `importData` runs and the heap retained by its result for the bench generator's records as
    YAML, TOML and XML at 1, 5, 10 and 50 MiB (YAML up to the YAML limit). TOML and XML at 5 MiB
    take at most 2 s each. HYPOTHESIS (sandbox, Node 22.22.0, 4 cores, §Current evidence): YAML
    5.4 s / 0.4 GB at 5 MiB and 56 s / 4.0 GB at 52 MiB; TOML 0.6 s at 4.8 MiB and 6.1 s / 1.1 GB at
    49 MiB; XML 0.3 s at 5.7 MiB and 4.5 s / 0.7 GB at 59 MiB.
11. **Web (web e2e):** in the web extension (spec 013), "Convert YAML to JSON", "Convert TOML to
    JSON" and "Convert XML to JSON" each pass one criterion 5 case on the virtual file system, and
    spec 013's command coverage map lists the four commands.
12. **Offline and licenses:** `yaml` 2.9.1 (ISC), `smol-toml` 1.9.0 (BSD-3-Clause) and `saxes` 6.0.0
    (ISC, with `xmlchars` 2.2.0, MIT) are the only new runtime dependencies, all in `core`, all with
    no further dependencies, bundled into the extension host only (never the webview); `pnpm
    check:licenses` passes. `pnpm check:offline` passes; each new allowlist entry is a string the
    libraries hold but never fetch (`saxes`'s `http://www.w3.org/XML/1998/namespace` and
    `http://www.w3.org/2000/xmlns/`, any link in a library message) and is named by the Reviewer
    (AGENTS rule 3).

## Where we differ from jsoneditoronline.org
- The site has no YAML, TOML or XML support: its features page and docs name only JSON and CSV for
  opening, importing and exporting (§Current evidence). This spec is our own addition.
- The feature map's wording is "to JSON on open". Opening a `.yaml` file in the CHR JSON editor
  would need a style-preserving YAML editor (spec 002's guarantees) to write edits back; this spec
  converts on command instead, and the source file never changes.

## Scope
- **In:** the importer (A1–A6, Y1–Y8, TM1–TM5, XM1–XM8) in `core` with its three libraries; the
  corpus, coverage, round-trip and hostile-input tests; the three convert commands and "Import
  YAML, TOML or XML…" with their menus, messages, warnings channel and size checks; JSON Lines
  tabs; locked large-file tabs; the bench rows and UNK-077's YAML limit; the web e2e cases; one
  README line per command.
- **Out:** export from JSON to YAML, TOML or XML (UNK-076: import only); editing YAML, TOML or
  XML in place; carrying comments (into JSONC, say); YAML or TOML or XML files under other
  extensions (`.plist`, `.svg`, `.csproj`, `.yaml.j2`); encodings other than UTF-8; XML Schema or
  DTD validation and typed values from them; namespace resolution; YAML 1.1 timestamps as dates;
  a preview panel (there are no options to set: spec 009's panel exists for its options); the
  Chrome app (020), which can reuse the core importer.

## Current evidence (D2 — path + lines / section)
- Requirement: `docs/research/feature-map.md:115` (P2 "Convert YAML, TOML, XML to JSON on open",
  Ours, M); `:54` (JSON Flow, a VS Code extension, converts YAML, TOML, CSV and XML to JSON);
  `spec/INDEX.md` P2 backlog item 017; spec 006 §Scope Out ("YAML, TOML, XML and CSV (specs 017,
  009)").
- Site: jsoneditoronline.org/features/ and jsoneditoronline.org/docs/ (fetched 2026-10-13): no
  mention of YAML, TOML or XML; "You can open both JSON and CSV files"; "You can also import CSV
  and export JSON to CSV".
- Precedents this spec follows: UNK-035 (owner, "New file beside it"); UNK-042 (owner, "Both": a
  new file beside the source, and an import that replaces the open document's data through 002
  R14); UNK-034 (owner, "Write null" for non-finite numbers); UNK-043 and UNK-067 (owner, "Exact"
  and "Exact number" for CSV cell values); spec 009 criteria 4, 5, 8 and 10 (the CSV flow, sizes
  and locked tabs); spec 016 criteria 5, 6 and G9 (untitled fallback, broken-source message,
  depth limit); spec 015 B1, B2 and §Terms (big numbers).
- Library sandbox (2026-10-13, Node 22.22.0, `npm` registry, scratchpad only):
  - Versions and licenses from `npm view`: `yaml` 2.9.1 (2026-09-11, ISC, no dependencies);
    `smol-toml` 1.9.0 (2026-09-22, BSD-3-Clause, no dependencies; 1.9.1 is from 2026-10-09, too
    new to pin); `saxes` 6.0.0 (ISC, depends on `xmlchars` 2.2.0, MIT, no dependencies).
  - Rejected: `js-yaml` 5.4.3 parses 5 MiB in 0.4 s (15× faster) but depends on `argparse` 2.0.1,
    license `Python-2.0`, which AGENTS rule 4 does not allow (`scripts/check-licenses.mjs` walks
    every production dependency); it also returns rounded numbers with no source text.
    `fast-xml-parser` 5.11.2 (MIT) now pulls six dependencies and maps XML its own way; `saxes` is
    a strict, well-formedness-checking SAX parser and leaves the mapping (XM1–XM8) to us.
  - `yaml` with `intAsBigInt` gives `12345678901234567890` and `0x1F` as `BigInt`s, and every
    scalar's source range, so A2's decimal text comes from the file; without options it gives
    `12345678901234567000`. Core schema: `on: push` → `{"on":"push"}`. Under `%YAML 1.1`, `on`,
    `yes` and `y` become `true`, so a file with keys `on`, `yes` and `y` fails as duplicate keys.
    `merge: true` applies `<<`. `!Ref Foo` gives `"Foo"` plus warning `TAG_RESOLVE_FAILED`. Nine
    levels of nine aliases: "Excessive alias count indicates a resource exhaustion attack".
    Repeated keys are an error unless `uniqueKeys: false`.
  - `smol-toml` without `integersAsBigInt` rejects `9007199254740993` ("integer value cannot be
    represented losslessly"); with `'asNeeded'` it gives a `BigInt` only for such integers.
    `TomlDate.toISOString()`: `1979-05-27 07:32:00Z` → `1979-05-27T07:32:00.000Z`,
    `…00.999999-07:00` → `…00.999-07:00`, local date `1979-05-27`, local time `07:32:00.000`.
    `0.1000000000000000000001` → `0.1`, `1e400` → `Infinity`.
  - `saxes`: `<!DOCTYPE a [<!ENTITY e "boom">]><a>&e; &#65;</a>` gives text `&e; A` and an
    "undefined entity" error event, with no expansion; `<a><b></a>` gives "unexpected close tag"
    at 1:10.
  - Time and heap (bench generator's record shape, 30,000 and ~300,000 records): YAML
    `parseDocument` 5.4 s and 408 MB at 5.2 MiB, 54.8 s and 3,970 MB at 52.1 MiB (`toJS` 0.1 s and
    1.4 s more); TOML 0.57 s and 110 MB at 4.8 MiB, 6.1 s and 1,059 MB at 49.3 MiB; XML (`saxes`
    plus a minimal mapping) 0.31 s and 77 MB at 5.7 MiB, 4.5 s and 726 MB at 59.1 MiB. A 50 MiB
    YAML file would hold the extension host for about a minute and needs about 4 GB of heap: hence
    the YAML limit (UNK-077). Spec 008's 50 MiB JSON parse retains ~1.1 GB (`bench/RESULTS.md`
    §Memory), the same order as TOML and XML at that size.
  - URLs in the libraries' code: `saxes.js` holds `http://www.w3.org/XML/1998/namespace`,
    `http://www.w3.org/2000/xmlns/` and two links in comments; `yaml` holds
    `http://yaml.org/type/merge.html` and links to MDN and tc39 in comments.
- Writing new files, the save dialog and untitled sources: spec 006 criterion 6 (UNK-035),
  `packages/vscode-extension/src/convertCommand.ts`; spec 016 criterion 5.
- Data-level writes keep comments: spec 002 R14; `diff` at `packages/core/src/diff.ts`;
  `FormatAdapter.applyPatch` (`packages/core/src/formats/types.ts`).
- Output text: `stringify(data, format, style)` at `packages/core/src/formats/stringify.ts`
  (throws on non-finite numbers for JSON, hence A3).
- Web host: ADR-013; spec 013 criterion 2 (no Node built-ins outside `src/node/**`); the three
  libraries are plain ECMAScript with no Node built-in imports (checked by the browser bundle in
  T3).

## Changes to approved specs (AGENTS rule 7)
None. Spec 006's §Scope Out already names spec 017 for YAML, TOML and XML.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-075 | How an XML document becomes JSON (shape and value types) | XM1–XM8, criteria 1, 2; T1 | resolved (owner): ★ Compact |
| UNK-076 | Whether 017 also exports JSON to YAML, TOML or XML | §Scope, Goal | resolved (owner): ★ Import only |
| UNK-077 | The YAML limit (largest YAML file converted) | criteria 8, 10; T4 | delegated: evidence rule in the ledger |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [x] Result-affecting UNKNOWNS resolved (UNK-077 is delegated and decided by T4's bench run)
- [x] Human approval recorded
