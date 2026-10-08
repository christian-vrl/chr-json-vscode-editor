<!-- Snapshot of the Claude Doc "JSON Editor Extension: Feature Map" (https://claude.ai/code/artifact/5773627f-247b-4b53-bcae-a1bfe9bc557e), revision 10, exported 2026-10-08 for 001 T1.
     Rationale and research only. The open checklist at the end is settled: name and publisher in UNK-002, site checks in UNK-013,
     JavaScript queries in spec 011 and CSV in spec 009 (spec/INDEX.md).
     The spec/ files win wherever this snapshot differs from them. -->

# JSON Editor Extension: Feature Map

Oct 8, 2026 · @Christian

Build v1 as a VS Code custom editor around vanilla-jsoneditor, which already provides tree, text and table modes, repair, transform, sort, search and schema validation offline. Our own work is file sync, theming, offline schemas, JSON, JSONC and JSON5 editing that keeps comments, then compare, CSV and large files. No existing extension combines these: the closest wraps only the old tree view and loses edits above about 1 MB. One correction to the brief: the library is ISC licensed, not MIT, which is just as permissive.

## What jsoneditoronline.org does

The site is built on the author's own open-source library, so most editing features come free with it; the site-only extras are two-panel compare, CSV conversion, and cloud documents. jsoneditoronline.org blocks automated access from this research environment, so the site-only rows below come from [Toolradar's listing](https://toolradar.com/tools/json-editor-online) and prior knowledge of the site, and should be confirmed by hand. Library rows were checked against the [svelte-jsoneditor README](https://github.com/josdejong/svelte-jsoneditor).

| Area | Feature | In the library? |
| --- | --- | --- |
| Modes | Tree mode: expand/collapse, inline edit of keys and values, drag to reorder, insert/duplicate/extract/remove via context menu | Yes |
| Modes | Text mode (CodeMirror): syntax highlight, folding, lint markers, indentation guides | Yes |
| Modes | Table mode for arrays of objects, nested fields flattened into columns | Yes |
| Navigation | Breadcrumb navigation bar with editable path (JSONPath or JSON Pointer) | Yes |
| Navigation | Status bar: cursor position, selection size | Yes |
| Formatting | Format (pretty print) and compact, configurable indentation and tabs | Yes |
| Formatting | Smart format (keeps short arrays and objects on one line) | No, site only |
| Formatting | Ask to format when compact JSON is pasted | Yes |
| Repair | Auto-repair on load (comments, trailing commas, single quotes, missing quotes, Python constants, JSONP, MongoDB types), accept or repair manually | Yes, via jsonrepair |
| Transform | Transform modal with wizard (filter, sort, pick fields) and live preview | Yes |
| Transform | Query languages: JSONQuery, JMESPath, JSONPath, Lodash, plain JavaScript | Yes |
| Sort | Sort object keys or array items by a field, ascending or descending, recursively | Yes |
| Search | Search and replace, including in keys | Yes |
| Validation | JSON Schema validation (Ajv) with inline errors; custom validators | Yes |
| Values | Boolean toggles, color picker swatch, timestamp tag, enum dropdowns from schema | Yes |
| Values | Long strings truncated with Show more; escape control and unicode characters | Yes |
| Editing | Undo/redo, copy/cut/paste of nodes, multi-select | Yes |
| Large files | Up to 512 MB in tree mode; text mode warns above 10 MB | Yes |
| Numbers | Lossless big numbers via a pluggable parser (lossless-json) | Yes, opt-in |
| Compare | Two panels side by side, structural diff highlighting, copy left to right and back | No, site only |
| Convert | Import CSV to JSON, export JSON to CSV | No, site only |
| Files | Open file, open from URL, save to disk, drag and drop | No, site only |
| Cloud | Save documents online, share by link, recent documents list | No, site only |
| Plans | Free, Ad-Free ($2/month), Developer ($5/month, private cloud docs, 1 MB per cloud doc) | Not relevant offline |

## Existing VS Code extensions and the gaps

No extension offers tree, text and table modes on one live document, and none embeds svelte-jsoneditor; the closest, Json Editor by Nick DeMayo, wraps the old jsoneditor tree only and loses edits above about 1 MB. Install counts and versions were read from the Marketplace and Open VSX on 2026-10-08.

| Extension | Installs | What it does | What it lacks |
| --- | --- | --- | --- |
| [Paste JSON as Code](https://marketplace.visualstudio.com/items?itemName=quicktype.quicktype) | 3.05M | Generates types for about 27 languages from JSON | Not a viewer or editor |
| [JSON Tools](https://marketplace.visualstudio.com/items?itemName=eriklynd.json-tools) | 1.55M | Pretty print and minify | Everything else |
| [JSON Crack](https://marketplace.visualstudio.com/items?itemName=AykutSarac.jsoncrack-vscode) | 776K | Read-only graph view, offline | Editing, query, diff, schema |
| [Sort JSON objects](https://marketplace.visualstudio.com/items?itemName=richie5um2.vscode-sort-json) | 731K | Many key sort orders, sort on save, JSONC (last updated 2021) | JSON5, any view |
| [Json Editor](https://marketplace.visualstudio.com/items?itemName=nickdemayo.vscode-json-editor) | 375K | Editable tree from the old josdejong/jsoneditor | Text and table modes, transform, diff, repair; refreshes on save only; edits above about 1 MB can be lost |
| [JSON Flow](https://marketplace.visualstudio.com/items?itemName=imgildev.vscode-json-flow) | 73K | Editable node graph for JSON, JSONC, JSON5; converts YAML, TOML, CSV, XML to JSON; code generation; image export | Key renames, diff, repair, schema; not meant for large files |
| [Better JSON5](https://marketplace.visualstudio.com/items?itemName=BlueGlassBlock.better-json5) | 16K | JSON5 language server: schema validation, completion, formatter, sort | Any visual view, query, diff, repair |
| [JSON Smart Viewer](https://open-vsx.org/api/mashurr/json-smart-viewer) | 3K (Open VSX) | Claims tree, table and graph views, fast on hundreds of MB | Read-only; new (Sept 2026), not verified |

Gaps that make our extension worth building:

1. One editor with tree, text and table modes over the same document, kept live in sync with the file.
2. Editable table mode for arrays of objects.
3. A transform modal with JSONQuery, JMESPath, JSONPath or JavaScript and a live preview.
4. Structural compare that ignores key order and shows differences in the tree.
5. Automatic repair of broken JSON (unquoted keys, Python literals, truncated files, NDJSON) inside the editor.
6. Schema validation shown inline in tree and table views, not only in text.
7. JSON5 and JSONC in a visual editor that keeps comments and formatting.
8. Editing large files (tens of MB) without losing changes.

## Formats and current specs

JSON, JSONC and JSON5 are all first-class in v1: each opens in tree, text and table, and edits are written back in the file's own format. No new JSON format has appeared; the recent movement is a JSONC spec effort (still a draft) and JSON Schema starting IETF standardization. Checked 2026-10-08.

| Spec | Latest | Status | What it means for us |
| --- | --- | --- | --- |
| [JSON, RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) / ECMA-404 | 2017 | Stable standard | Baseline. Strict mode for .json: no comments, no trailing commas written. |
| [JSONC, jsonc.org](https://jsonc.org/) | Undated draft | Draft, "subject to change" | `//` and `/* */` comments; trailing commas optional for parsers; recommends `.jsonc` and `application/jsonc`. Also a community [JSONC-Spec](https://github.com/JSONC-Spec/JSONC-Spec) draft (2025-09-01) that allows one trailing comma. Go is [discussing](https://github.com/golang/go/issues/74969) JSONC support citing both. |
| [JSON5](https://spec.json5.org/) | 1.0.0, March 2018 | Stable, no changes since | Unquoted keys, single quotes, trailing commas, hex, `Infinity`/`NaN`, multi-line strings, comments. |
| [JSON Schema](https://json-schema.org/specification) | 2020-12 | Current stable dialect | Ajv supports it; also support draft-07, which most real schemas still use. |
| [JSON Schema IETF draft](https://datatracker.ietf.org/doc/draft-ietf-jsonschema-json-schema/) | draft-03, 26 Aug 2026 | Working-group draft, aimed at Proposed Standard | Builds on 2020-12 and warns against adopting it yet. Watch it; no work now. |
| [JSONPath, RFC 9535](https://datatracker.ietf.org/doc/html/rfc9535) | Feb 2024 | Standard | The library's JSONPath (jsonpath-plus) follows the older Goessner syntax, which differs in places; label it as such or add an RFC 9535 engine later. |

How each format behaves in the extension:

- **Detection.** By language ID and extension: `.json` is JSON, `.jsonc` and VS Code's known JSONC files (settings.json, tsconfig.json, launch.json) are JSONC, `.json5` is JSON5. A status-bar picker overrides it.
- **Parsing.** One tolerant parser reads all three, then tracks which extensions the file uses. Strict JSON errors (a comment in a .json file) show as warnings with a quick fix, not as a failed load.
- **Writing.** Tree and table edits become minimal text edits, so comments, key quoting, trailing commas and spacing survive. A new value is written in the file's own style.
- **Conversion.** Commands to convert between JSON, JSONC and JSON5, warning when comments or `NaN`/`Infinity` would be lost going to strict JSON.
- **Schema.** Validation works on all three formats, mapped by `$schema`, `json.schemas` and Better JSON5's `json5.schemas`.

## Prioritized feature list

P0 ships in v1 and is mostly wiring the library into a custom editor; P1 closes the gaps no extension covers; P2 is polish. Effort: S is days, M is a week or two, L is several weeks.

| Priority | Feature | Source | Effort |
| --- | --- | --- | --- |
| P0 | Custom editor for .json, .jsonc and .json5 files: open with tree, text or table, switch modes, "Open in JSON Editor" command | Library + our glue | M |
| P0 | Two-way sync with the VS Code document (save, undo, dirty marker, Git diff, external edits) | Ours | M |
| P0 | JSON, JSONC and JSON5 parsing with format detection; tree and table edits keep comments, quoting and trailing commas | Ours (jsonc-parser, json5) | L |
| P0 | Format, compact, sort (keys and arrays), search and replace, undo/redo | Library | S |
| P0 | Auto-repair on open with accept or manual fix, plus a Repair JSON command for the text editor | Library (jsonrepair) | S |
| P0 | Transform modal: JSONQuery, JMESPath, JSONPath with live preview | Library | S |
| P0 | JSON Schema validation (2020-12 and draft-07) from `$schema`, `json.schemas` and workspace files, for all three formats, fully offline | Library + ours | M |
| P0 | Theme mapping to VS Code light, dark, high contrast | Ours | S |
| P0 | Everything bundled; no network calls, no telemetry | Ours | S |
| P1 | Convert between JSON, JSONC and JSON5, warning on lossy steps | Ours | S |
| P1 | Structural compare: pick two files or editor vs Git HEAD, diff ignoring key order, copy values across | Ours | L |
| P1 | Large-file mode: tested to 100 MB, open read-only above a threshold, streaming load | Ours | M |
| P1 | CSV import and export, including from table mode | Ours | M |
| P1 | Smart format (short arrays and objects on one line) | Ours | S |
| P1 | JavaScript and Lodash query languages (needs `unsafe-eval` in the webview) | Library | S |
| P1 | NDJSON / JSON Lines viewing in table mode | Ours | M |
| P2 | RFC 9535 JSONPath engine alongside the library's Goessner-style one | Ours | M |
| P2 | Lossless big numbers via lossless-json | Library | S |
| P2 | Generate JSON Schema from a document | Ours | M |
| P2 | Convert YAML, TOML, XML to JSON on open | Ours | M |
| P2 | Copy path as JSONPath or JSON Pointer, reveal node from text cursor | Library + ours | S |
| P2 | Settings: indentation, default mode, truncate length, escaping | Library | S |
| P2 | Chrome offline app from the same UI package | Ours | M |

Left out on purpose: cloud save, share links and accounts, since the extension is offline and the file system already does that job. Open from URL is optional and would be the only network feature, so it should be off by default if added.

## Reusing svelte-jsoneditor

Reuse it: [vanilla-jsoneditor](https://www.npmjs.com/package/vanilla-jsoneditor) (3.13.0, released 2026-07-24) gives us roughly 80% of the site inside a VS Code webview, and we build compare, CSV, smart format and file sync around it.

- **License is ISC, not MIT.** ISC is equally permissive (keep the copyright notice in our bundle). The author asks commercial users to help fund it; we are free, so a credit and a sponsor link in the README is the right gesture alongside crediting jsoneditoronline.org.
- **Use the vanilla build, not Svelte.** `createJSONEditor({ target, props })` works in a plain webview. Bundle it with esbuild into the extension so nothing loads from a CDN; the README's CDN route would break offline use.
- **Content Security Policy.** The JavaScript and Lodash query languages run through `new Function(...)` (README, queryLanguages section), and Ajv compiles schemas the same way. The webview CSP therefore needs `'unsafe-eval'`, or we drop those two languages and precompile schemas. Recommendation: allow `'unsafe-eval'` only in the editor webview, with a nonce for scripts.
- **Offline traps.** `createAjvValidatorAsync` can fetch remote `$ref` schemas; we should resolve schemas from the workspace and VS Code's `json.schemas` setting instead, with no network. Icons are bundled Font Awesome SVGs, so no font downloads.
- **Syncing with the file.** The editor keeps its own state; we implement a `CustomTextEditorProvider` that maps `onChange` to `WorkspaceEdit`s on the real document, so VS Code's save, undo, dirty marker and Git diff keep working. JSON Patch results from `onChange` make small edits cheap.
- **JSON5 and JSONC.** The `parser` option takes any `{ parse, stringify }`, so the `json5` package plugs in for viewing and editing. Its `stringify` drops comments and original formatting, so tree edits to a commented file would erase comments. Plan: tree and table edits on JSONC/JSON5 apply targeted text edits with `jsonc-parser` (as VS Code does) rather than re-stringifying the whole file.
- **Theming.** The library is styled through `--jse-*` CSS variables; we map them to VS Code's `--vscode-*` theme variables so light, dark and high-contrast themes work.
- **Large files.** The 512 MB claim is for the browser; VS Code's webview message passing and the extension host add copies. Expect a practical ceiling well below that and test 50 MB and 200 MB files early.
- **Not in the library:** compare view, CSV import/export, smart format, open from URL, file management. These are our own code.
- **Size.** The npm package unpacks to about 10 MB with all builds; a single minified bundle should be a few MB at most, still fine for a .vsix.

## Chrome offline app and open questions

The Chrome spin-off is cheap if the webview UI is a standalone web app from day one. Build the editor UI as its own package that talks to a small host interface (load, save, settings); VS Code and a Chrome extension or installable PWA each implement that interface. Chrome Apps are discontinued, so the target is a Manifest V3 extension page or a PWA using the File System Access API; MV3 forbids `unsafe-eval` on extension pages, so the JavaScript and Lodash query languages would be off there unless run in a sandboxed page.

- [ ] Confirm the site-only feature rows by hand, since the site blocked this research.
- [ ] Pick the extension name and publisher ID for the Marketplace and Open VSX.
- [ ] Decide whether the JavaScript query language ships in v1, given the CSP trade-off.
- [ ] Decide whether CSV export ships in v1 or v1.1.
