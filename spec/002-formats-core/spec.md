# SPEC 002 — Format core: JSON, JSONC, JSON5 with style-preserving edits

> **Status:** `approved (owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
The visual editor works on plain data. Re-serializing after a tree or table edit would erase
comments, quoting, trailing commas and spacing in JSONC and JSON5 files, and reformat JSON files.
The owner requires all three formats as first-class (P0).

## Goal
`packages/core/formats` detects the format, parses it to data, and applies any RFC 6902 JSON Patch
as minimal text edits that leave every byte outside the edited spans unchanged.

## Acceptance criterion (falsifiable)
1. **Golden:** for every case in `tests/golden/{json,jsonc,json5}/`, `applyPatch(input, patch, format)`
   is byte-equal to `expected`.
2. **Data:** `parse(expected).data` deep-equals `applyPatch` of `immutable-json-patch` on `parse(input).data`.
3. **Property:** 10 000 random documents × random patches per format (fast-check, seed committed):
   rule 2 holds, and every input comment whose span does not intersect a removed, replaced or moved
   member appears byte-identical in the output.
4. **Coverage:** each case's `case.json` holds tags `{op, location, comments, trailingComma, quote, keyStyle, special}`.
   A coverage test asserts, per format, at least one case for every cell of two grids:
   `op` ∈ {add, replace, remove, move, copy, test, test-fail} × `location` ∈ {root, nested-object, array-start, array-middle, array-end},
   and `op` × `comments` ∈ {none, before, after, inline} (comments grid for jsonc and json5 only); plus per-format tags `trailingComma` ∈ {yes, no} (jsonc, json5) and, for json5,
   `quote` ∈ {single, double}, `keyStyle` ∈ {quoted, unquoted}, `special` ∈ {hex, infinity-nan, multiline-string}.
5. **Detection:** `detect(path, languageId?, text?)` per R11; table-driven test of every listed name.
6. **Stringify:** `parse(stringify(x, format, style)).data` deep-equals `x` over the property generator.
7. **Benchmark:** `bench/RESULTS.md` records parse and single-edit times for 1, 10, 50 MB per format, with machine spec.
8. **Whole-document actions keep comments:** golden cases tagged `op` ∈ {compact, sort, data-diff} pass byte-equal for jsonc and json5, and every comment not attached to a removed member is present in the output.
9. **Diff:** for random pairs `(a, b)` (fast-check, seed committed), applying `diff(a, b)` to `a` deep-equals `b`; for arrays where `b` inserts or removes items of `a`, the patch contains only those `add`/`remove` ops.

## Style rules (golden cases encode these)
- **R1 Indent:** new lines use the nearest sibling's indentation; with no sibling, the parent's indent plus the file's dominant indent unit (tabs or N spaces). A file with no line breaks has indent unit 2 spaces for any new multi-line container.
- **R2 Placement:** `add` to `/-` or a new key appends after the last member; an array index inserts at that index.
- **R3 Single-line containers:** a container written on one line stays on one line; new members are joined with `, ` (or the separator already used).
- **R4 Quotes (JSON5):** new keys are unquoted when identifier-safe and most existing keys in that object are unquoted; strings use the file's majority quote character. JSON/JSONC always double quotes.
- **R5 Removal:** per UNK-008.
- **R6 Trailing commas:** a container with a trailing comma keeps one after its new last member; one without never gains one. JSON never gets one.
- **R7 Move:** `move` = remove at `from` (R5 decides which comments go) + add at `path` carrying those comments.
- **R8 Scalars:** new numbers and strings are written as `JSON.stringify` would, except R4's quote character in JSON5. Patch values are plain JSON, so JSON5-only literals (hex, `Infinity`, `NaN`) appear only in inputs; existing ones are never rewritten unless their member is replaced.
- **R9 Atomicity:** a failing `test` op or an invalid path returns an error and leaves the text unchanged.
- **R10 Line endings and final newline** are preserved as detected.
- **R12 Compact with comments:** whitespace between tokens is removed; each `//` comment becomes `/* … */` (a `*/` inside its text becomes `*\/`); block comments stay as written. Strict JSON has no comments, so plain compaction applies.
- **R13 Sort with comments:** each member moves together with the comments attached to it by R5; comments attached to no member (file header, before a closing bracket) keep their place relative to the container.
- **R14 Data-level actions** (transform result, repair result, compare copy-across, CSV merged into a document) are applied as `diff(oldData, newData)` → JSON Patch → `applyPatch`, so every surviving member keeps its comments and style. Comments attached to removed members are removed with them, with no confirmation (UNK-015). Repair of a document that does not parse follows UNK-018.
- **R11 Detection order:** explicit `languageId` (`json`, `jsonc`, `json5`) → VS Code JSONC file names (`settings.json`, `tsconfig.json`, `jsconfig.json`, `launch.json`, `tasks.json`, `extensions.json`, `devcontainer.json`, `.eslintrc.json`), checked before the extension because they end in `.json` (UNK-019) → extension (`.json`, `.jsonc`, `.json5`) → content: strict JSON parse succeeds → json; else JSONC parse succeeds → jsonc; else json5.

## Scope
- **In:** detection, tolerant parse with diagnostics (strict-JSON violations in `.json` are warnings, not load failures), `applyPatch`, `stringify`, `Style` detection, comment-keeping compact and sort, structural `diff`, repair spike, golden corpus, property tests, benchmark.
- **Out:** conversion commands (spec 006), UI (spec 003).

## Current evidence (D2 — path + lines / section)
- Requirement: owner messages 2026-10-08 (all three formats; keep comments in whole-document actions, UNK-015); `docs/research/feature-map.md` §Formats and current specs.
- Spec targets: ADR-005. `jsonc-parser` 3.3.1 exposes `parseTree`, `modify`, `applyEdits` (MIT). `immutable-json-patch` is ISC and already a dependency of `vanilla-jsoneditor`.
- `Style` type: `AGENTS.md` §Glossary.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-008 | Comments that travel on remove/move | R5, R7 cases | see ledger |
| UNK-012 | JSON5 CST: package vs own | T5 | delegated |
| UNK-018 | Comment-keeping repair of broken JSONC/JSON5 | T11 | delegated |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded (G0)
