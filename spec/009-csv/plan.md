# PLAN 009 — CSV import and export

> Derives from spec `009`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Corpus first, as in 002 and 006: the golden cases for X1–X7 and I1–I7 are written and reviewed
before the code, so they are the contract.

The CSV code is ours, in `packages/core/src/csv/`, rather than csv42: csv42 cannot pass
`pnpm check:licenses` as published (no `license` field), and the spec departs from its defaults
where they lose data (I7 typing, BOM, extra fields, empty nested values, object row sources). It keeps
csv42's field-name notation, so files exchanged with jsoneditoronline.org read the same. Export is
two passes over the row source (collect field names, then write rows); import is one pass of a
small RFC 4180 state machine producing records, then field-name parsing and value typing. Neither
re-parses JSON text: export takes data, import returns data, and the callers turn data into text
with core's existing `stringify` (new file) or `diff` + `applyPatch` (002 R14, replace document data).

The panel is a page in `app-shell` (`Csv.svelte`) with its own `CsvHostAdapter` (load the source,
save, copy, create file, replace data) and a dev host, so `pnpm test:web` covers options, preview,
warnings and errors without VS Code, and the Chrome app (020) can reuse it. The preview runs core's
functions in the webview on the first 100 rows (export: the first 100 items; import: the text up to
the 101st record), so it stays fast at any size; the host runs the full conversion only when a
button writes. In VS Code the page runs in a `WebviewPanel` with spec 003's CSP; the host reads the
row source (criterion 7) or the CSV file, posts it to the panel, and performs the writes. The
editor webview tells the host the current row source path through a new message when "Export to
CSV…" runs from the CHR JSON editor (protocol bump).

This plan assumes the recommended options of UNK-042, UNK-043 and UNK-044; if the owner picks
otherwise, the spec changes first and this plan follows.

## Constraints / invariants
- `core` stays pure TypeScript with no DOM and no Node APIs; `jsonToCsv`, `csvToJson` and
  `detectDelimiter` are exported from `@chr-json-editor/core`. No new runtime dependency.
- The new corpus folder `tests/golden/csv/` is added to `.prettierignore` and `pnpm test:golden`, and
  is skipped by the format corpus loader like `tests/golden/convert/`.
- Only the extension host writes files and documents (ADR-003). The source document is changed only
  by "Replace Document Data", as one undoable `WorkspaceEdit`; everything else writes a new file.
- New message types are validated like `packages/app-shell/src/protocol.ts` and bump `PROTOCOL_VERSION`.
- No network; the panel's CSP is spec 003's.
- No overwrite without snapshot/backup (D4): all work in branches.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Golden corpus + coverage test | cases with `options.json`, `case.json` and expected bytes or data | criterion 2 green; Reviewer checks every case against X1–X7 and I1–I7 |
| B | `jsonToCsv`, `csvToJson` in core | `packages/core/src/csv/`, property suite, timings | criteria 1, 3 |
| C | CSV panel page | `Csv.svelte`, `CsvHostAdapter`, dev host, web tests | criteria 6, 9 (theme) |
| D | VS Code panel and commands | panel, commands, menus, writes, row source message, e2e | criteria 4, 5, 7, 8, 9 |
| E | Large-file mode | locked-tab menus, `parseData` export, e2e | criterion 10 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 Delimiter detection guesses wrong on short or irregular files | the user can pick the delimiter, the preview shows the result first; golden cases pin I3 on files with one column, quoted delimiters and ragged rows |
| R2 Typing surprises (a code like `1e3` or `0012` read as a number) | UNK-043 ★ keeps any text that would change as a string; golden cases list each I7 branch |
| R3 Flattening arrays makes very many columns (the site warns about this) | off by default; the preview shows the column count before saving |
| R4 Table mode's shown array cannot be read from the library | spec §Current evidence HYPOTHESIS; T4 verifies first and, if it fails, falls back to the document's data and records why in the PR, with the spec changed first |
| R5 Large CSV files (tens of MB) in the extension host | one linear pass; timings and peak heap at 1, 10 and 50 MiB (`bench/generate.mjs`) recorded in T2's PR; the ceiling stops anything VS Code itself would refuse |
| R7 Export from a large-file-mode tab needs the data, which 008 avoids keeping (about 2 GB of heap for a full parse at 50 MiB, 008 §Problem) | T5 exports through `parseData` (008 criterion 6), which holds only the data and nothing in core's cache; the data and the CSV text live only for the export; T5's PR records peak heap for a 50 MiB export |
| R6 Excel reads UTF-8 CSV without a BOM as a local code page | the "UTF-8 BOM (for Excel)" option |

## Definition of Done
1. Criteria 1–10 pass in CI. 2. UNK-043 resolved before T1; UNK-042 and UNK-044 before T3.
