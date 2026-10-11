# PLAN 012 — JSON Lines (NDJSON)

> Derives from spec `012`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
JSON Lines becomes a fourth `Format` (`jsonl`) with its own `FormatAdapter`, so everything built on
formats (detection, the format badge and picker, 003's sync, 006's conversion, 008's `parseData`,
009's row source and R14 replace) takes it through the paths that already exist instead of a
parallel one. Proposed ADR-012 records the new format target.

Corpus first, as in 002, 006 and 009: the golden cases for L1–L10 and J1–J2 are written and
reviewed before the code, so they are the contract.

The adapter is thin. Parse splits the text into lines (L1) and parses each non-blank line with the
`json` adapter (strict JSON, positions kept), shifting the item nodes' offsets into the whole text.
Item-level operations are line splices (L3–L6); nested operations hand the item's slice to the
`json` adapter's `applyPatch` and splice the result back (L7), which keeps one-line containers on
one line (002 R3, checked in §Current evidence); root replacement goes through `diff` (L8). Because
an item is a line, an edit never re-reads the other lines, so item edits stay cheap at any size.
`parseData('jsonl')` is `JSON.parse` per line, which should beat a whole-array parse (criterion 12).

Conversion extends `convert` with two pairs families: J1 writes the item bytes into an array; J2
reuses 006's conversion to `json` and 002 R12's compaction per item, so 006's loss modal and
UNK-034/UNK-035 apply unchanged. `repairLines` (L10) reuses the 002 T11 repair engine line by line.

In the UI, the host tells the webview the format and the allowed modes (Table and Tree, start in
Table) through the existing open message; the bad-line banner is an app-shell component next to
008's large-file banner, sharing its read-only state. The webview's `parserFor('jsonl')` skips the
`JSON.parse` fast path (a one-line JSON Lines file is valid JSON with the wrong shape).

This plan assumes the recommended options of UNK-050 and UNK-051; if the owner picks otherwise, the
spec changes first and this plan follows.

## Constraints / invariants
- `core` stays pure TypeScript with no DOM and no Node APIs; `jsonl` is exported through the same
  `Format`, `getAdapter`, `detect`, `convert` and `parseData`; `repairLines` is exported from
  `@chr-json-editor/core`. No new runtime dependency.
- Adding `'jsonl'` to `Format` must not change any existing format's behavior: every existing
  golden, convert and property suite stays green unchanged (D3).
- Switches over `Format` (picker, convert menus, `when` clauses, stringify, actions) handle `jsonl`
  explicitly; TypeScript's exhaustiveness checks find them.
- The new corpus folder `tests/golden/jsonl/` is added to `.prettierignore` and `pnpm test:golden`.
- Only the extension host writes documents (ADR-003); "Repair Lines" is one `WorkspaceEdit`.
- New or changed messages are validated in `packages/app-shell/src/protocol.ts` and bump
  `PROTOCOL_VERSION`.
- No network; the webview CSP is spec 003's.
- No overwrite without snapshot/backup (D4): all work in branches.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Golden corpus + coverage test | `tests/golden/jsonl/`, `tests/golden/convert/*jsonl*` | criterion 2 green; Reviewer checks every case against L1–L10, J1–J2 |
| B | `jsonl` adapter, detection, `parseData` | adapter, R11 entries, property suite, bench rows | criteria 1, 3, 4, 12 |
| C | Conversion and `repairLines` | `convert` pairs, `repairLines`, property suite | criterion 5; L10 cases |
| D | Webview: modes, bad-line banner | app-shell state, banner, web tests | criteria 8 (web), 13 (theme) |
| E | VS Code: open, edit, commands | selector, menus, picker, convert commands, Repair Lines, e2e | criteria 6, 7, 8, 9, 13 |
| F | Large files and CSV | 008 and 009 wiring for `jsonl`, e2e | criteria 10, 11 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 A fourth format reaches code that assumes three (`FORMATS` arrays, regexes in `when` clauses, convert menus) | T2 adds `jsonl` to the union first and fixes every compile error; e2e for menus in T5 |
| R2 The webview's `JSON.parse` fast path reads a one-line file as the item instead of `[item]` | `parserFor('jsonl')` skips it; a web test opens a one-line file (§Current evidence) |
| R3 A nested edit writes a line break into a line (a value the `json` adapter would lay out on several lines) | L7 golden cases add containers to one-line items; the property suite of criterion 3 checks the line count; if it fails, the adapter compacts the written value (002 R12) before splicing and the spec records it |
| R4 Many small lines make parse slower than one big array (a parse per line) | criterion 12 compares with the array form in the same run; if it fails, T2's PR records the numbers and parses blocks of lines in one `JSON.parse` |
| R5 Repair of a run of bad lines guesses wrong (a pretty-printed record vs separate broken lines) | L10 tries the whole run as one value first, then line by line; nothing it cannot repair is changed, and the edit is one undo |
| R6 Large logs with one truncated last line are common; read-only until repaired could annoy | UNK-051 asks the owner; "Repair Lines" fixes a truncated last line in one click (`jsonrepair` closes it) |

## Definition of Done
1. Criteria 1–13 pass in CI. 2. UNK-050 and UNK-051 resolved before T1.
